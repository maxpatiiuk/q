/**
 * Split a stream of text chunks into batches of records. Like in AWK, a
 * trailing separator at the end of input does not produce an extra empty
 * record.
 *
 * Records are yielded in batches (one per chunk) rather than one by one to
 * avoid paying for an async iteration step per record.
 */
export async function* splitRecords(
  chunks: AsyncIterable<string>,
  separator: string,
): AsyncGenerator<readonly string[], void, undefined> {
  let remainder = '';
  for await (const chunk of chunks) {
    const records = (remainder + chunk).split(separator);
    remainder = records.pop() ?? '';
    if (records.length > 0) {
      yield records;
    }
  }
  if (remainder !== '') {
    yield [remainder];
  }
}

export async function readAll(chunks: AsyncIterable<string>): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of chunks) {
    parts.push(chunk);
  }
  return parts.join('');
}

/** Remove one trailing separator so that it does not create an empty record */
export const stripTrailingSeparator = (
  text: string,
  separator: string,
): string =>
  text.endsWith(separator) ? text.slice(0, -separator.length) : text;

/** Arguments of `Array.prototype.slice()`, applied to the records */
export type Slice = {
  readonly start: number;
  readonly end: number | undefined;
};

export type SlicedBatch = {
  readonly records: readonly string[];
  /** 1-based line number of the first record in the batch */
  readonly lineNumber: number;
};

/**
 * Like `records.slice(start, end)`, but streaming. Kept records are always
 * contiguous, so each batch only needs its first line number.
 *
 * Negative indexes need to know where the input ends, so the last `-start`
 * records (or `-end` records) are held back until then.
 */
export async function* sliceRecords(
  batches: AsyncIterable<readonly string[]>,
  { start, end }: Slice,
): AsyncGenerator<SlicedBatch, void, undefined> {
  if (start < 0) {
    let tail: readonly string[] = [];
    let total = 0;
    for await (const batch of batches) {
      total += batch.length;
      tail = [...tail, ...batch].slice(start);
    }
    const tailStart = total - tail.length;
    const absoluteEnd =
      end === undefined ? total : end < 0 ? total + end : Math.min(end, total);
    const records = tail.slice(0, Math.max(absoluteEnd - tailStart, 0));
    if (records.length > 0) {
      yield { records, lineNumber: tailStart + 1 };
    }
    return;
  }

  let position = 0;
  if (end === undefined || end >= 0) {
    for await (const batch of batches) {
      const from = Math.max(start - position, 0);
      const to =
        end === undefined
          ? batch.length
          : Math.min(end - position, batch.length);
      if (from < to) {
        yield {
          records:
            from === 0 && to === batch.length ? batch : batch.slice(from, to),
          lineNumber: position + from + 1,
        };
      }
      position += batch.length;
      if (end !== undefined && position >= end) {
        return;
      }
    }
    return;
  }

  // Positive start, negative end: hold back the last -end records
  let pending: readonly string[] = [];
  let pendingLineNumber = start + 1;
  for await (const batch of batches) {
    pending = [...pending, ...batch.slice(Math.max(start - position, 0))];
    position += batch.length;
    const ready = pending.length + end;
    if (ready > 0) {
      yield { records: pending.slice(0, ready), lineNumber: pendingLineNumber };
      pendingLineNumber += ready;
      pending = pending.slice(ready);
    }
  }
}
