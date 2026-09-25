import { describe, expect, it } from 'vitest';
import {
  readAll,
  sliceRecords,
  splitRecords,
  stripTrailingSeparator,
} from './records.ts';

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

describe(sliceRecords, () => {
  const records = Array.from({ length: 7 }, (_, index) => `r${index}`);
  const bounds = [undefined, -9, -7, -3, -1, 0, 1, 3, 7, 9];

  async function* batchesOf(
    size: number,
  ): AsyncGenerator<readonly string[], void, undefined> {
    for (let index = 0; index < records.length; index += size) {
      yield records.slice(index, index + size);
    }
  }

  it.each([1, 2, 3, 10])(
    'matches Array.slice() for batches of %i',
    async (size) => {
      for (const start of bounds) {
        for (const end of bounds) {
          const batches = await Array.fromAsync(
            sliceRecords(batchesOf(size), { start: start ?? 0, end }),
          );
          const expected = records.slice(start, end);
          expect(batches.flatMap((batch) => batch.records)).toEqual(expected);
          // Line numbers of the kept records are contiguous
          expect(
            batches.flatMap(({ records, lineNumber }) =>
              records.map((_, index) => lineNumber + index),
            ),
          ).toEqual(expected.map((record) => Number(record.slice(1)) + 1));
        }
      }
    },
  );
});
