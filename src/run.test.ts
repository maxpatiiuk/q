import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, type Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { run } from './run.ts';

function capture(): { readonly stream: Writable; readonly text: () => string } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, text: () => chunks.join('') };
}

async function q(args: readonly string[], input = '') {
  const stdin = new PassThrough();
  stdin.end(input);
  const stdout = capture();
  const stderr = capture();
  const exitCode = await run({
    args,
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

const shells = 'root /bin/zsh\nmax /bin/bash\nguest /bin/zsh\n';

describe(run, () => {
  it('transforms each line', async () => {
    expect(await q(['l.toUpperCase()'], 'a\nb\n')).toEqual({
      exitCode: 0,
      stdout: 'A\nB\n',
      stderr: '',
    });
  });

  it('filters lines with booleans, regexes and falsy values', async () => {
    const expected = 'root /bin/zsh\nguest /bin/zsh\n';
    expect((await q(['l.includes("zsh")'], shells)).stdout).toBe(expected);
    expect((await q(['l.test(/zsh/)'], shells)).stdout).toBe(expected);
    expect((await q(['/zsh/'], shells)).stdout).toBe(expected);
    expect((await q(['l.match(/(\\w+)sh/)?.[1]'], shells)).stdout).toBe(
      'z\nba\nz\n',
    );
  });

  it('inverts the match', async () => {
    expect((await q(['-v', '/zsh/'], shells)).stdout).toBe('max /bin/bash\n');
  });

  it('exposes columns, index and file', async () => {
    expect((await q(['`${i}:${f}:${c[1]}`'], shells)).stdout).toBe(
      '0:-:/bin/zsh\n1:-:/bin/bash\n2:-:/bin/zsh\n',
    );
    expect((await q(['-F', '/', 'c.at(-1)'], shells)).stdout).toBe(
      'zsh\nbash\nzsh\n',
    );
  });

  it('joins arrays with spaces per line, and with newlines in -1 mode', async () => {
    expect((await q(['c.toReversed()'], 'a b\nc d\n')).stdout).toBe(
      'b a\nd c\n',
    );
    expect((await q(['-1', 'l.split("\\n").reverse()'], 'a\nb\n')).stdout).toBe(
      'b\na\n',
    );
    expect((await q(['-1', 'c.map(([a, b]) => [b, a])'], shells)).stdout).toBe(
      '/bin/zsh root\n/bin/bash max\n/bin/zsh guest\n',
    );
    expect((await q(['-1', 'lines.length'], shells)).stdout).toBe('3\n');
  });

  it('calls returned functions', async () => {
    expect((await q(['l.toUpperCase'], 'a\nb\n')).stdout).toBe('A\nB\n');
    expect((await q(['Number'], '1\nx\n')).stdout).toBe('1\nNaN\n');
  });

  it('pre-declares accumulators', async () => {
    expect((await q(['n += +c[1];', '-e', 'n'], 'a 1\nb 2\n')).stdout).toBe(
      '3\n',
    );
    expect((await q(['a.push(c[0]);', '-e', 'a'], 'a 1\nb 2\n')).stdout).toBe(
      'a b\n',
    );
  });

  it('slices the lines of each file', async () => {
    const input = 'header\na\nb\nfooter\n';
    expect((await q(['-n', '-s', '1,-1', 'l'], input)).stdout).toBe(
      '2:a\n3:b\n',
    );
    expect((await q(['-s', '-2', '`${i}:${l}`'], input)).stdout).toBe(
      '0:b\n1:footer\n',
    );
    expect((await q(['-1', '-s', ',2', 'lines'], input)).stdout).toBe(
      'header\na\n',
    );
  });

  it('runs --begin and --end with shared state', async () => {
    expect(
      await q(
        [
          '-b',
          'console.log("start"); let total = 0',
          'total += l.length;',
          '-e',
          'console.log("end"); total',
        ],
        'ab\ncde\n',
      ),
    ).toEqual({ exitCode: 0, stdout: 'start\nend\n5\n', stderr: '' });
  });

  it('keeps console.log output in order with the regular output', async () => {
    expect((await q(['console.log(i); l'], 'a\nb\n')).stdout).toBe(
      '0\na\n1\nb\n',
    );
  });

  it('prints JSON', async () => {
    expect((await q(['-j', '({ l, n: +c[1] })'], 'a 1\nb 2\n')).stdout).toBe(
      '{"l":"a 1","n":1}\n{"l":"b 2","n":2}\n',
    );
  });

  it('parses JSON input', async () => {
    expect((await q(['-J', 'l.a'], '{"a":1}\n\n{"a":2}\n')).stdout).toBe(
      '1\n2\n',
    );
    expect(
      (
        await q(
          ['-1J', 'l.items.map((item) => item.name)'],
          '{"items":[{"name":"x"},{"name":"y"}]}',
        )
      ).stdout,
    ).toBe('x\ny\n');
  });

  it('supports await', async () => {
    expect(
      (
        await q(
          ['await new Promise((resolve) => setTimeout(() => resolve(l), 1))'],
          'a\nb\n',
        )
      ).stdout,
    ).toBe('a\nb\n');
  });

  it('supports grep-like output options', async () => {
    expect((await q(['-n', '/zsh/'], shells)).stdout).toBe(
      '1:root /bin/zsh\n3:guest /bin/zsh\n',
    );
    expect((await q(['-c', '/zsh/'], shells)).stdout).toBe('2\n');
    expect((await q(['-m', '1', '/zsh/'], shells)).stdout).toBe(
      'root /bin/zsh\n',
    );
    expect(await q(['-q', '/zsh/'], shells)).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('supports custom separators', async () => {
    expect((await q(['-z', 'l.toUpperCase()'], 'a\0b\0')).stdout).toBe(
      'A\0B\0',
    );
    expect(
      (await q(['--rs', ';', '--ors', ',', '--ofs', '-', 'c'], 'a b;c d'))
        .stdout,
    ).toBe('a-b,c-d,');
  });

  it('reads files, reporting the ones that could not be read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'q-'));
    const first = join(directory, 'first.txt');
    const second = join(directory, 'second.txt');
    await writeFile(first, 'a\nb\n');
    await writeFile(second, 'c\n');
    const missing = join(directory, 'missing.txt');

    expect((await q(['-H', '`${i}:${l}`', first, second])).stdout).toBe(
      `${first}:0:a\n${first}:1:b\n${second}:2:c\n`,
    );
    expect((await q(['-1', 'lines', first, second])).stdout).toBe('a\nb\nc\n');

    const result = await q(['l', missing, second]);
    expect(result.stdout).toBe('c\n');
    expect(result.stderr).toContain(`q: ${missing}: ENOENT`);
    expect(result.exitCode).toBe(2);
  });

  it('exits with 1 when nothing was selected', async () => {
    expect((await q(['/nope/'], shells)).exitCode).toBe(1);
    expect((await q(['l'], '')).exitCode).toBe(1);
  });

  it('reports errors with their location', async () => {
    expect(await q(['l.nope()'], 'a\n')).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'q: -:1: TypeError: l.nope is not a function\n',
    });
    expect((await q(['-J', 'l'], '{\n')).stderr).toMatch(
      /^q: -:1: SyntaxError: /u,
    );
    expect((await q(['l.'], '')).stderr).toMatch(
      /^q: SyntaxError: .+ \(in <code>\)\n$/u,
    );
    expect((await q(['--nope'])).stderr).toContain(
      "Try 'q --help' for more information.",
    );
  });

  it('flushes the output produced before an error', async () => {
    expect(
      await q(['if (i === 1) throw new Error("boom"); l'], 'a\nb\n'),
    ).toEqual({
      exitCode: 2,
      stdout: 'a\n',
      stderr: 'q: -:2: Error: boom\n',
    });
  });

  it('prints help and version', async () => {
    expect((await q(['--help'])).stdout).toMatch(/^Usage: q /u);
    expect((await q(['--version'])).stdout).toMatch(/^\d+\.\d+\.\d+\n$/u);
  });
});
