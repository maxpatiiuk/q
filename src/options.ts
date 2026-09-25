import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  type FieldSeparator,
  parseFieldSeparator,
  unescapeSeparator,
} from './separators.ts';

export type Options = {
  readonly begin: string;
  readonly main: string;
  readonly end: string;
  /** `-` stands for stdin */
  readonly files: readonly string[];
  readonly slurp: boolean;
  readonly json: boolean;
  readonly jsonInput: boolean;
  readonly invert: boolean;
  readonly count: boolean;
  readonly quiet: boolean;
  readonly lineNumber: boolean;
  readonly withFilename: boolean;
  readonly maxCount: number;
  readonly fieldSeparator: FieldSeparator;
  readonly recordSeparator: string;
  readonly outputFieldSeparator: string;
  readonly outputRecordSeparator: string;
};

export type Command =
  | { readonly type: 'help' }
  | { readonly type: 'run'; readonly options: Options }
  | { readonly type: 'version' };

export class UsageError extends Error {
  override name = 'UsageError';
}

export const usage = `Usage: ni [options] <code> [file...]
       ni [options] -f <code-file> [file...]

Run JavaScript code for each line of input. The value of the last expression
is printed in place of the line:
  string, number, ...     print it
  true                    print the original line
  undefined, null, false  skip the line
  RegExp                  print the line if it matches (ni '/error/i')
  array                   print items joined by spaces (by newlines in -1 mode)
  object                  print as JSON
A trailing semicolon disables the implicit return (ni 'console.log(l);').

Variables:
  l, line        current line (the whole input in -1 mode)
  i, index       0-based line index across all inputs
  c, columns     line split into columns (see -F); an array of rows in -1 mode
  f, file        current file name ("-" for stdin)
  lines          all lines (-1 mode only)

Options:
  -b, --begin <code>        run code before reading input (may repeat); its
                            variables are visible in <code> and in --end
  -e, --end <code>          run code after reading input and print its value
  -f, --file <file>         read <code> from a file
  -1, --slurp               run <code> once for the whole input
  -F, --field-separator <fs>
                            column separator: " " (default) splits on runs of
                            whitespace, one character is literal, longer is a
                            regex; /regex/flags is accepted too
  -j, --json                print results as JSON (one per line)
  -J, --json-input          parse each line (the whole input in -1 mode) as JSON
  -v, --invert-match        print the lines that <code> excludes
  -c, --count               print only the number of selected lines
  -m, --max-count <n>       stop after <n> selected lines
  -n, --line-number         prefix output with the 1-based line number
  -H, --with-filename       prefix output with the file name
  -q, --quiet               print nothing; exit on first selected line
  -z, --null-data           records are separated by NUL instead of newline
      --rs <separator>      input record separator (default "\\n")
      --ors <separator>     output record separator (default: --rs)
      --ofs <separator>     output field separator (default " ")
  -h, --help                show this help
  -V, --version             show version

Exit status is 0 if any line was selected, 1 otherwise, and 2 on error.

Examples:
  ls | ni 'l.toUpperCase()'
  ls | ni '/zsh/'
  ps aux | ni 'c[10]'
  ni -F, -b 'sum = 0' 'sum += +c[2];' -e 'sum' data.csv
  cat data.json | ni -1J 'l.items.map((item) => item.name)'`;

const optionsConfig = {
  begin: { type: 'string', short: 'b', multiple: true },
  end: { type: 'string', short: 'e', multiple: true },
  file: { type: 'string', short: 'f' },
  slurp: { type: 'boolean', short: '1' },
  'field-separator': { type: 'string', short: 'F' },
  json: { type: 'boolean', short: 'j' },
  'json-input': { type: 'boolean', short: 'J' },
  'invert-match': { type: 'boolean', short: 'v' },
  count: { type: 'boolean', short: 'c' },
  'max-count': { type: 'string', short: 'm' },
  'line-number': { type: 'boolean', short: 'n' },
  'with-filename': { type: 'boolean', short: 'H' },
  quiet: { type: 'boolean', short: 'q' },
  'null-data': { type: 'boolean', short: 'z' },
  rs: { type: 'string' },
  ors: { type: 'string' },
  ofs: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
} as const;

export function parseCommand(
  args: readonly string[],
  readCodeFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): Command {
  const { values, positionals } = parseArguments(args);
  if (values.help === true) {
    return { type: 'help' };
  }
  if (values.version === true) {
    return { type: 'version' };
  }

  const [main, files] =
    values.file === undefined
      ? [positionals[0], positionals.slice(1)]
      : [readCodeFile(values.file), positionals];
  if (main === undefined) {
    throw new UsageError('missing <code> argument');
  }

  const recordSeparator = separatorOr(
    values.rs,
    values['null-data'] === true ? '\0' : '\n',
  );
  if (recordSeparator === '') {
    throw new UsageError('--rs must not be empty');
  }
  const quiet = values.quiet === true;
  return {
    type: 'run',
    options: {
      begin: (values.begin ?? []).join('\n'),
      main,
      end: (values.end ?? []).join('\n'),
      files: files.length === 0 ? ['-'] : files,
      slurp: values.slurp === true,
      json: values.json === true,
      jsonInput: values['json-input'] === true,
      invert: values['invert-match'] === true,
      count: values.count === true,
      quiet,
      lineNumber: values['line-number'] === true,
      withFilename: values['with-filename'] === true,
      maxCount: quiet ? 1 : parseMaxCount(values['max-count']),
      fieldSeparator: parseFieldSeparator(values['field-separator'] ?? ' '),
      recordSeparator,
      outputFieldSeparator: separatorOr(values.ofs, ' '),
      outputRecordSeparator: separatorOr(values.ors, recordSeparator),
    },
  };
}

function parseArguments(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      options: optionsConfig,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

const separatorOr = (value: string | undefined, fallback: string): string =>
  value === undefined ? fallback : unescapeSeparator(value);

function parseMaxCount(value: string | undefined): number {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new UsageError(`invalid --max-count: ${value}`);
  }
  return count;
}
