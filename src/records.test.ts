import { describe, expect, it } from 'vitest';
import { readAll, splitRecords, stripTrailingSeparator } from './records.ts';

async function* fromChunks(
  ...chunks: readonly string[]
): AsyncGenerator<string, void, undefined> {
  yield* chunks;
}

const collect = async (
  batches: AsyncIterable<readonly string[]>,
): Promise<readonly string[]> => (await Array.fromAsync(batches)).flat();

describe(splitRecords, () => {
  it('splits records across chunk boundaries', async () => {
    expect(
      await collect(splitRecords(fromChunks('a\nb', 'c\n', '\nd'), '\n')),
    ).toEqual(['a', 'bc', '', 'd']);
  });

  it('does not produce a record for a trailing separator', async () => {
    expect(await collect(splitRecords(fromChunks('a\nb\n'), '\n'))).toEqual([
      'a',
      'b',
    ]);
    expect(await collect(splitRecords(fromChunks(''), '\n'))).toEqual([]);
  });

  it('supports multi-character separators split across chunks', async () => {
    expect(
      await collect(splitRecords(fromChunks('a-', '-b--c'), '--')),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe(readAll, () => {
  it('concatenates chunks', async () => {
    expect(await readAll(fromChunks('a', 'b'))).toBe('ab');
  });
});

describe(stripTrailingSeparator, () => {
  it('removes one trailing separator', () => {
    expect(stripTrailingSeparator('a\n\n', '\n')).toBe('a\n');
    expect(stripTrailingSeparator('a', '\n')).toBe('a');
  });
});
