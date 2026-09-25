import { describe, expect, it } from 'vitest';
import { parseCommand, parseSlice, UsageError } from './options.ts';

const parseOptions = (
  args: readonly string[],
  readCodeFile?: (path: string) => string,
) => {
  const command = parseCommand(args, readCodeFile);
  if (command.type !== 'run') {
    throw new Error(`Expected a run command, got ${command.type}`);
  }
  return command.options;
};

describe(parseCommand, () => {
  it('uses AWK-like defaults and reads stdin by default', () => {
    expect(parseOptions(['l'])).toEqual({
      begin: '',
      main: 'l',
      end: '',
      files: ['-'],
      slurp: false,
      json: false,
      jsonInput: false,
      invert: false,
      count: false,
      quiet: false,
      lineNumber: false,
      withFilename: false,
      maxCount: Number.POSITIVE_INFINITY,
      fieldSeparator: undefined,
      recordSeparator: '\n',
      outputFieldSeparator: ' ',
      outputRecordSeparator: '\n',
    });
  });

  it('accepts options after the code, and combined short flags', () => {
    const options = parseOptions([
      '-1vjJ',
      '-b',
      'a',
      'l',
      'file.txt',
      '-b',
      'b',
      '-e',
      'c',
      '-F,',
    ]);
    expect(options).toMatchObject({
      begin: 'a\nb',
      main: 'l',
      end: 'c',
      files: ['file.txt'],
      slurp: true,
      invert: true,
      json: true,
      jsonInput: true,
      fieldSeparator: ',',
    });
  });

  it('reads the code from a file with -f', () => {
    expect(
      parseOptions(['-f', 'code.js', 'a.txt'], (path) => `code of ${path}`),
    ).toMatchObject({ main: 'code of code.js', files: ['a.txt'] });
  });

  it('handles separators', () => {
    expect(parseOptions(['-z', 'l'])).toMatchObject({
      recordSeparator: '\0',
      outputRecordSeparator: '\0',
    });
    expect(
      parseOptions(['--rs', ';', '--ors', String.raw`\n`, '--ofs', ',', 'l']),
    ).toMatchObject({
      recordSeparator: ';',
      outputRecordSeparator: '\n',
      outputFieldSeparator: ',',
    });
  });

  it('makes -q stop at the first selected line', () => {
    expect(parseOptions(['-q', '-m', '5', 'l'])).toMatchObject({
      quiet: true,
      maxCount: 1,
    });
  });

  it('recognizes --help and --version', () => {
    expect(parseCommand(['--help'])).toEqual({ type: 'help' });
    expect(parseCommand(['-V'])).toEqual({ type: 'version' });
  });

  it('rejects invalid usage', () => {
    expect(() => parseCommand([])).toThrow(UsageError);
    expect(() => parseCommand(['--nope', 'l'])).toThrow(UsageError);
    expect(() => parseCommand(['-m', '-1', 'l'])).toThrow(UsageError);
    expect(() => parseCommand(['--rs', '', 'l'])).toThrow(UsageError);
  });
});

describe(parseSlice, () => {
  it('parses Array.slice() arguments', () => {
    expect(parseSlice('1')).toEqual({ start: 1, end: undefined });
    expect(parseSlice('1,-1')).toEqual({ start: 1, end: -1 });
    expect(parseSlice(',-3')).toEqual({ start: 0, end: -3 });
    expect(parseSlice('2,')).toEqual({ start: 2, end: undefined });
  });

  it('rejects invalid slices', () => {
    expect(() => parseSlice('a')).toThrow(UsageError);
    expect(() => parseSlice('1,2,3')).toThrow(UsageError);
    expect(() => parseSlice('1.5')).toThrow(UsageError);
  });

  it('accepts negative slices as a separate argument', () => {
    const slice = (args: readonly string[]) => {
      const command = parseCommand(args);
      return command.type === 'run' ? command.options.slice : undefined;
    };
    expect(slice(['-s', '-3', 'l'])).toEqual({ start: -3, end: undefined });
    expect(slice(['--slice', '-3,-1', 'l'])).toEqual({ start: -3, end: -1 });
    expect(slice(['-s-2', 'l'])).toEqual({ start: -2, end: undefined });
  });
});
