type FunctionConstructor = new (...argumentsAndBody: string[]) => unknown;

const SyncFunction: FunctionConstructor = Function;
const AsyncFunction = async function () {}.constructor as FunctionConstructor;

/**
 * Names under which each record's data is exposed to the user's code.
 * Every value has a short and a long alias.
 */
export const recordParameters = [
  'l',
  'line',
  'i',
  'index',
  'c',
  'columns',
  'f',
  'file',
  'lines',
] as const;

export type RecordArguments = {
  readonly line: unknown;
  readonly index: number;
  /** Columns of the line, or rows of columns in `-1` mode */
  readonly columns:
    readonly string[] | readonly (readonly string[])[] | undefined;
  readonly file: string | undefined;
  readonly lines: readonly string[] | undefined;
};

export type Program = {
  readonly main: (record: RecordArguments) => unknown;
  readonly end: () => unknown;
  /**
   * Splitting each line into columns is the costliest part of processing a
   * record, so it's skipped when the code can't be using the columns.
   */
  readonly usesColumns: boolean;
};

export type ProgramSource = {
  readonly begin: string;
  readonly main: string;
  readonly end: string;
};

const usesAwait = (code: string): boolean => /\bawait\b/u.test(code);

/**
 * Whether the code may reference the columns. False positives (e.g. a "c"
 * inside a string) only cost some performance.
 */
const usesColumns = (code: string): boolean =>
  /(?<![.$\w])(?:c|columns)(?![$\w])/u.test(code);

const compile = (body: string, isAsync: boolean): unknown =>
  new (isAsync ? AsyncFunction : SyncFunction)(body);

function compiles(body: string, isAsync: boolean): boolean {
  try {
    compile(body, isAsync);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compile a piece of the program on its own to report syntax errors with a
 * helpful location, rather than one within the generated wrapper.
 */
function assertCompiles(label: string, body: string, isAsync: boolean): void {
  try {
    compile(body, isAsync);
  } catch (error) {
    throw error instanceof SyntaxError
      ? new SyntaxError(`${error.message} (in ${label})`)
      : error;
  }
}

/** Indexes right after each `;` or newline: candidate statement boundaries */
const statementBoundaries = (code: string): readonly number[] =>
  Array.from(code.matchAll(/[;\n]/gu), ({ index }) => index + 1);

/**
 * Make the last expression statement of the code its return value, like in
 * Ruby or Rust. As in Rust, a trailing semicolon opts out of that.
 *
 * Without a JS parser at hand, candidate splits into "statements" +
 * "last expression" are tried from the longest last expression to the
 * shortest, and the first one that compiles wins.
 */
export function withImplicitReturn(code: string, isAsync: boolean): string {
  const trimmed = code.trimEnd();
  if (trimmed === '' || trimmed.endsWith(';')) {
    return code;
  }
  const body = [0, ...statementBoundaries(trimmed)]
    .map(
      (boundary) =>
        `${trimmed.slice(0, boundary)}\nreturn (${trimmed.slice(boundary)}\n);`,
    )
    .find((candidate) => compiles(candidate, isAsync));
  return body ?? code;
}

const functionKeyword = (isAsync: boolean): string =>
  isAsync ? 'async function' : 'function';

/**
 * Compile begin, main, and end code into a single closure so that variables
 * declared in `--begin` are visible to the main code and to `--end`.
 *
 * Code runs in sloppy mode on purpose: like in AWK, assigning to an
 * undeclared variable creates a global.
 */
export async function compileProgram(
  { begin, main, end }: ProgramSource,
  console: Console,
): Promise<Program> {
  const isBeginAsync = usesAwait(begin);
  const isMainAsync = usesAwait(main);
  const isEndAsync = usesAwait(end);
  const mainBody = withImplicitReturn(main, isMainAsync);
  const endBody = withImplicitReturn(end, isEndAsync);
  assertCompiles('--begin', begin, isBeginAsync);
  assertCompiles('<code>', mainBody, isMainAsync);
  assertCompiles('--end', endBody, isEndAsync);

  const source = [
    begin,
    'return {',
    `  main: ${functionKeyword(isMainAsync)} (${recordParameters.join(', ')}) {`,
    mainBody,
    '  },',
    `  end: ${functionKeyword(isEndAsync)} () {`,
    endBody,
    '  },',
    '};',
  ].join('\n');
  const factory = new (isBeginAsync ? AsyncFunction : SyncFunction)(
    'console',
    source,
  ) as (console: Console) => RawProgram | Promise<RawProgram>;
  const program = await factory(console);
  return {
    main: ({ line, index, columns, file, lines }) =>
      program.main(
        line,
        line,
        index,
        index,
        columns,
        columns,
        file,
        file,
        lines,
      ),
    end: program.end,
    usesColumns: usesColumns(main),
  };
}

type RawProgram = {
  readonly main: (...values: readonly unknown[]) => unknown;
  readonly end: () => unknown;
};

/**
 * Lets the user write `l.test(/regex/)` as the more natural counterpart of
 * `/regex/.test(l)`. Only installed if String doesn't already have it.
 */
export function installStringTest(): void {
  if ('test' in String.prototype) {
    return;
  }
  Object.defineProperty(String.prototype, 'test', {
    configurable: true,
    writable: true,
    value(this: string, pattern: RegExp | string): boolean {
      if (typeof pattern === 'string') {
        return this.includes(pattern);
      }
      pattern.lastIndex = 0;
      return pattern.test(this);
    },
  });
}
