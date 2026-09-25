export type RenderOptions = {
  readonly invert: boolean;
  readonly json: boolean;
  /** Whether the whole input was processed at once (`-1`) */
  readonly slurp: boolean;
  readonly outputFieldSeparator: string;
  readonly outputRecordSeparator: string;
};

const isIterable = (value: unknown): value is Iterable<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  Symbol.iterator in value &&
  typeof value[Symbol.iterator] === 'function';

/** `undefined`, `null` and `false` exclude the record, like in grep/AWK */
export const isExcluded = (value: unknown): value is undefined | null | false =>
  value === undefined || value === null || value === false;

/**
 * Turn the user code's return value into the text to print, or `undefined` if
 * the record is excluded.
 *
 * - a RegExp is tested against the record (`q '/zsh/'`)
 * - `true` keeps the original record
 * - `undefined`, `null`, `false` exclude the record
 * - anything else replaces the record
 */
export function render(
  result: unknown,
  record: string,
  options: RenderOptions,
): string | undefined {
  const value = result instanceof RegExp ? testRegExp(result, record) : result;
  if (options.invert) {
    return isExcluded(value) ? record : undefined;
  }
  if (isExcluded(value)) {
    return undefined;
  }
  return formatValue(value === true ? record : value, options);
}

function testRegExp(regExp: RegExp, text: string): boolean {
  regExp.lastIndex = 0;
  return regExp.test(text);
}

export const formatValue = (value: unknown, options: RenderOptions): string =>
  options.json
    ? toJson(value, options.slurp)
    : toText(
        value,
        options.slurp
          ? [options.outputRecordSeparator, options.outputFieldSeparator]
          : [options.outputFieldSeparator],
      );

/**
 * Iterables (arrays, sets, generators...) are joined with the first
 * separator, their nested iterables with the next one, and so on.
 * In `-1` mode, `[[a, b], [c, d]]` thus prints as rows of columns.
 */
function toText(value: unknown, separators: readonly string[]): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  if (isIterable(value)) {
    const [separator = ' ', ...nestedSeparators] = separators;
    const next = nestedSeparators.length > 0 ? nestedSeparators : [separator];
    return Array.from(value, (item) => toText(item, next)).join(separator);
  }
  return typeof value === 'object' && !hasCustomToString(value)
    ? JSON.stringify(value, jsonReplacer)
    : String(value);
}

/** Dates, URLs, errors and the like print as themselves rather than JSON */
const hasCustomToString = (value: object): boolean =>
  'toString' in value && value.toString !== Object.prototype.toString;

const toJson = (value: unknown, pretty: boolean): string =>
  JSON.stringify(value, jsonReplacer, pretty ? 2 : undefined) ?? String(value);

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  return isIterable(value) && !Array.isArray(value) ? Array.from(value) : value;
}
