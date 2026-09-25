import { describe, expect, it, vi } from 'vitest';
import {
  compileProgram,
  installStringTest,
  withImplicitReturn,
} from './compile.ts';

const evaluate = (code: string, l = 'line'): unknown =>
  new Function('l', withImplicitReturn(code, false))(l);

describe(withImplicitReturn, () => {
  it('returns a single expression', () => {
    expect(evaluate('l.toUpperCase()')).toBe('LINE');
    expect(evaluate('{ a: l }')).toEqual({ a: 'line' });
  });

  it('returns the last expression after statements', () => {
    expect(evaluate('let t = l[0]; `${t}${l[2]}`')).toBe('ln');
    expect(evaluate('const a = 1\nconst b = 2\na + b')).toBe(3);
  });

  it('is not confused by separators inside strings', () => {
    expect(evaluate('let x = ";"; x + ";" + l')).toBe(';;line');
  });

  it('follows automatic semicolon insertion rules', () => {
    expect(evaluate('let x = l\nx\n.length')).toBe(4);
  });

  it('does not return when the code ends with a semicolon', () => {
    expect(evaluate('l.toUpperCase();')).toBeUndefined();
  });

  it('leaves code with explicit returns and statements alone', () => {
    expect(evaluate('if (l) return 1; return 2')).toBe(1);
    expect(evaluate('if (!l) { l = "x" }')).toBeUndefined();
  });

  it('supports await', async () => {
    const body = withImplicitReturn('await Promise.resolve(l)', true);
    const AsyncFunction = async function () {}.constructor as new (
      ...args: string[]
    ) => (l: string) => Promise<unknown>;
    expect(await new AsyncFunction('l', body)('line')).toBe('line');
  });
});

describe(compileProgram, () => {
  const record = {
    line: 'a b',
    index: 0,
    columns: ['a', 'b'],
    file: '-',
    lines: undefined,
  };

  it('exposes record variables under short and long names', async () => {
    const program = await compileProgram(
      { begin: '', main: '[l, line, i, index, c, columns, f, file]', end: '' },
      console,
    );
    expect(program.main(record)).toEqual([
      'a b',
      'a b',
      0,
      0,
      ['a', 'b'],
      ['a', 'b'],
      '-',
      '-',
    ]);
  });

  it('shares --begin variables with the main code and --end', async () => {
    const program = await compileProgram(
      { begin: 'let count = 0', main: 'count += 1;', end: 'count' },
      console,
    );
    program.main(record);
    program.main(record);
    expect(program.end()).toBe(2);
  });

  it('pre-declares accumulators that --begin may redeclare', async () => {
    const defaults = await compileProgram(
      { begin: '', main: '[s, n, a]', end: '' },
      console,
    );
    expect(defaults.main(record)).toEqual(['', 0, []]);
    const redeclared = await compileProgram(
      { begin: 'let n = 5', main: 'n', end: '' },
      console,
    );
    expect(redeclared.main(record)).toBe(5);
  });

  it('calls a returned function with the line', async () => {
    const compile = (main: string) =>
      compileProgram({ begin: '', main, end: '' }, console);
    expect((await compile('l.toUpperCase')).main(record)).toBe('A B');
    expect((await compile('(x) => x + "!"')).main(record)).toBe('a b!');
    expect((await compile('String')).main(record)).toBe('a b');
    expect(await (await compile('async () => l')).main(record)).toBe('a b');
    expect(await (await compile('await 0; (x) => x.length')).main(record)).toBe(
      3,
    );
  });

  it('runs --begin once, at compile time', async () => {
    const log = vi.fn();
    await compileProgram(
      { begin: 'console.log("start")', main: 'l', end: '' },
      { ...console, log },
    );
    expect(log).toHaveBeenCalledWith('start');
  });

  it('reports syntax errors with their location', async () => {
    await expect(
      compileProgram({ begin: '', main: 'l.', end: '' }, console),
    ).rejects.toThrow(/in <code>/u);
    await expect(
      compileProgram({ begin: 'let x =', main: 'l', end: '' }, console),
    ).rejects.toThrow(/in --begin/u);
  });

  it('detects whether the code may use columns', async () => {
    const compile = (main: string) =>
      compileProgram({ begin: '', main, end: '' }, console);
    expect((await compile('c[0]')).usesColumns).toBe(true);
    expect((await compile('columns.length')).usesColumns).toBe(true);
    expect((await compile('l.concat("x")')).usesColumns).toBe(false);
  });
});

describe(installStringTest, () => {
  it('adds String.prototype.test', () => {
    installStringTest();
    const line = 'zsh' as string & {
      readonly test: (pattern: RegExp | string) => boolean;
    };
    expect(line.test(/z/u)).toBe(true);
    expect(line.test('x')).toBe(false);
    expect(Object.keys(String.prototype)).not.toContain('test');
  });
});
