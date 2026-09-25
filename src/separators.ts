/**
 * `undefined` means AWK's default: split on runs of whitespace, ignoring
 * leading and trailing whitespace.
 */
export type FieldSeparator = string | RegExp | undefined;

const escapes: Readonly<Record<string, string>> = {
  '0': '\0',
  n: '\n',
  r: '\r',
  t: '\t',
  '\\': '\\',
};

/**
 * Interpret C-style escapes (`\t`, `\n`, `\r`, `\0`, `\\`) in a separator
 * given on the command line, like AWK does for `-F '\t'`.
 */
export const unescapeSeparator = (value: string): string =>
  value.replaceAll(
    /\\([0nrt\\])/gu,
    (match, character: string) => escapes[character] ?? match,
  );

const regexLiteral = /^\/(?<source>.+)\/(?<flags>[dgimsuvy]*)$/u;

/**
 * Follows AWK conventions: a single space means "runs of whitespace", any
 * other single character is literal, and anything longer is a regular
 * expression. `/pattern/flags` syntax is accepted too.
 */
export function parseFieldSeparator(value: string): FieldSeparator {
  const literal = regexLiteral.exec(value)?.groups;
  if (literal !== undefined) {
    return new RegExp(literal.source ?? '', literal.flags);
  }
  const unescaped = unescapeSeparator(value);
  if (unescaped === ' ') {
    return undefined;
  }
  return unescaped.length === 1 ? unescaped : new RegExp(unescaped);
}

// Without the "u" flag, as it makes splitting ~2x slower
const whitespace = /\s+/;

export function splitColumns(
  line: string,
  separator: FieldSeparator,
): readonly string[] {
  const trimmed = separator === undefined ? line.trim() : line;
  return trimmed === '' ? [] : trimmed.split(separator ?? whitespace);
}
