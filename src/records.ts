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
