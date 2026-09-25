import { describe, expect, it } from 'vitest';
import {
  parseFieldSeparator,
  splitColumns,
  unescapeSeparator,
} from './separators.ts';

describe(unescapeSeparator, () => {
  it('interprets C-style escapes', () => {
    expect(unescapeSeparator(String.raw`a\tb\nc\0d\\e\x`)).toBe(
      'a\tb\nc\0d\\e\\x',
    );
  });
});

describe(parseFieldSeparator, () => {
  it('treats a single space as "runs of whitespace"', () => {
    expect(parseFieldSeparator(' ')).toBeUndefined();
  });

  it('treats a single character literally', () => {
    expect(parseFieldSeparator('|')).toBe('|');
    expect(parseFieldSeparator(String.raw`\t`)).toBe('\t');
  });

  it('treats longer separators as regular expressions', () => {
    expect(parseFieldSeparator(', *')).toEqual(/, */);
    expect(parseFieldSeparator('/[,;]/i')).toEqual(/[,;]/i);
  });
});

describe(splitColumns, () => {
  it('splits on whitespace by default, ignoring the edges', () => {
    expect(splitColumns('  a \t b  c ', undefined)).toEqual(['a', 'b', 'c']);
    expect(splitColumns('   ', undefined)).toEqual([]);
  });

  it('keeps empty columns with an explicit separator', () => {
    expect(splitColumns('a,,b,', ',')).toEqual(['a', '', 'b', '']);
    expect(splitColumns('', ',')).toEqual([]);
    expect(splitColumns('a, b,c', /, */)).toEqual(['a', 'b', 'c']);
  });
});
