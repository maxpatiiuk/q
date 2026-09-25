import { createReadStream } from 'node:fs';
import packageJson from '../package.json' with { type: 'json' };
import type { Readable, Writable } from 'node:stream';
import { compileProgram, installStringTest, type Program } from './compile.ts';
import { type Options, parseCommand, usage, UsageError } from './options.ts';
import { createOutput, type Output } from './output.ts';
import {
  readAll,
  type Slice,
  sliceRecords,
  splitRecords,
  stripTrailingSeparator,
} from './records.ts';
import { formatValue, isExcluded, render } from './render.ts';
import { splitColumns } from './separators.ts';

export type Io = {
  readonly args: readonly string[];
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
};

export const exitCodes = {
  selected: 0,
  noneSelected: 1,
  error: 2,
} as const;

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

/** An exception thrown by the user's code or by parsing its input */
class ProgramError extends Error {
  constructor(error: unknown, location: string) {
    super(`${location}: ${formatError(error)}`, { cause: error });
  }
}

/** Failure to read one of the inputs. Reported, but does not stop processing */
class InputError extends Error {
  constructor(file: string, error: unknown) {
    super(`${file}: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }
}

const formatError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export async function run(io: Io): Promise<ExitCode> {
  const report = (message: string): void => {
    io.stderr.write(`q: ${message}\n`);
  };

  try {
    const command = parseCommand(io.args);
    if (command.type === 'help') {
      io.stdout.write(`${usage}\n`);
      return exitCodes.selected;
    }
    if (command.type === 'version') {
      io.stdout.write(`${packageJson.version}\n`);
      return exitCodes.selected;
    }
    return await execute(command.options, io, report);
  } catch (error) {
    if (error instanceof UsageError) {
      report(`${error.message}\nTry 'q --help' for more information.`);
    } else {
      report(
        error instanceof ProgramError ? error.message : formatError(error),
      );
    }
    return exitCodes.error;
  }
}

type Stats = {
  readonly selected: number;
  readonly hadFileError: boolean;
};

async function execute(
  options: Options,
  io: Io,
  report: (message: string) => void,
): Promise<ExitCode> {
  installStringTest();
  const output = createOutput(io.stdout);
  try {
    const program = await compileProgram(options, output.console);
    const input: Input = {
      open: (file) =>
        readInput(
          file,
          file === '-'
            ? io.stdin.setEncoding('utf8')
            : createReadStream(file, { encoding: 'utf8' }),
        ),
      reportError: (error) => report(error.message),
    };

    const { selected, hadFileError } = await (options.slurp
      ? processWhole(program, options, output, input)
      : processRecords(program, options, output, input));

    if (options.count) {
      output.write(`${selected}${options.outputRecordSeparator}`);
    }
    const endResult = await invoke(program.end, 'end');
    const printedEnd = !isExcluded(endResult);
    if (printedEnd) {
      output.write(
        `${formatValue(endResult, options)}${options.outputRecordSeparator}`,
      );
    }

    if (hadFileError) {
      return exitCodes.error;
    }
    return selected > 0 || printedEnd
      ? exitCodes.selected
      : exitCodes.noneSelected;
  } finally {
    await output.flush();
  }
}

type Input = {
  readonly open: (file: string) => AsyncIterable<string>;
  readonly reportError: (error: InputError) => void;
};

async function* readInput(
  file: string,
  chunks: AsyncIterable<string>,
): AsyncGenerator<string, void, undefined> {
  try {
    yield* chunks;
  } catch (error) {
    throw new InputError(file, error);
  }
}

async function processRecords(
  program: Program,
  options: Options,
  output: Output,
  input: Input,
): Promise<Stats> {
  let index = 0;
  let selected = 0;
  let hadFileError = false;
  if (options.maxCount === 0) {
    return { selected, hadFileError };
  }
  const shouldPrint = !options.quiet && !options.count;
  const hasPrefix = options.withFilename || options.lineNumber;

  for (const file of options.files) {
    try {
      for await (const batch of sliceRecords(
        splitRecords(input.open(file), options.recordSeparator),
        options.slice ?? noSlice,
      )) {
        let lineNumber = batch.lineNumber - 1;
        for (const record of batch.records) {
          lineNumber += 1;
          if (options.jsonInput && record.trim() === '') {
            continue;
          }
          let result: unknown;
          try {
            result = evaluateRecord(program, options, record, index, file);
            // Only await when needed: awaiting every record is costly
            if (isPromiseLike(result)) {
              result = await result;
            }
          } catch (error) {
            throw new ProgramError(error, `${file}:${lineNumber}`);
          }
          index += 1;

          const text = render(result, record, options);
          if (text === undefined) {
            continue;
          }
          selected += 1;
          if (shouldPrint) {
            output.write(
              `${hasPrefix ? prefix(options, file, lineNumber) : ''}${text}${options.outputRecordSeparator}`,
            );
            const drained = output.drained();
            if (drained !== undefined) {
              await drained;
            }
          }
          if (selected >= options.maxCount) {
            return { selected, hadFileError };
          }
        }
      }
    } catch (error) {
      if (!(error instanceof InputError)) {
        throw error;
      }
      input.reportError(error);
      hadFileError = true;
    }
  }
  return { selected, hadFileError };
}

function evaluateRecord(
  program: Program,
  options: Options,
  record: string,
  index: number,
  file: string,
): unknown {
  const line: unknown = options.jsonInput ? JSON.parse(record) : record;
  return program.main({
    line,
    index,
    columns:
      program.usesColumns && typeof line === 'string'
        ? splitColumns(line, options.fieldSeparator)
        : undefined,
    file,
    lines: undefined,
  });
}

async function processWhole(
  program: Program,
  options: Options,
  output: Output,
  input: Input,
): Promise<Stats> {
  const contents = await Promise.all(
    options.files.map(async (file) => {
      try {
        return await readAll(input.open(file));
      } catch (error) {
        if (!(error instanceof InputError)) {
          throw error;
        }
        input.reportError(error);
        return undefined;
      }
    }),
  );
  const lines = contents.flatMap((content) =>
    content === undefined
      ? []
      : splitWhole(content, options.recordSeparator, options.slice),
  );
  const text = lines.join(options.recordSeparator);
  const line = options.jsonInput
    ? await invoke(() => JSON.parse(text), 'input')
    : text;
  const result = await invoke(
    () =>
      program.main({
        line,
        index: 0,
        columns: program.usesColumns
          ? lines.map((line) => splitColumns(line, options.fieldSeparator))
          : undefined,
        file: options.files.length === 1 ? options.files[0] : undefined,
        lines,
      }),
    'main',
  );

  const rendered = render(result, text, options);
  if (rendered !== undefined && !options.quiet && !options.count) {
    output.write(`${rendered}${options.outputRecordSeparator}`);
  }
  return {
    selected: rendered === undefined ? 0 : 1,
    hadFileError: contents.includes(undefined),
  };
}

const noSlice: Slice = { start: 0, end: undefined };

function splitWhole(
  content: string,
  separator: string,
  slice: Slice | undefined,
): readonly string[] {
  const text = stripTrailingSeparator(content, separator);
  const lines = text === '' ? [] : text.split(separator);
  return slice === undefined ? lines : lines.slice(slice.start, slice.end);
}

const prefix = (options: Options, file: string, lineNumber: number): string =>
  [
    options.withFilename ? file : undefined,
    options.lineNumber ? lineNumber : undefined,
  ]
    .filter((part) => part !== undefined)
    .map((part) => `${part}:`)
    .join('');

/** Call user code, attributing any exception to where it happened */
async function invoke(
  callback: () => unknown,
  location: string,
): Promise<unknown> {
  try {
    return await callback();
  } catch (error) {
    throw new ProgramError(error, location);
  }
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  'then' in value &&
  typeof value.then === 'function';
