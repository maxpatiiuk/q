import { describe, expect, it } from 'vitest';
import { render, type RenderOptions } from './render.ts';

const options: RenderOptions = {
  invert: false,
  json: false,
  slurp: false,
  outputFieldSeparator: ' ',
  outputRecordSeparator: '\n',
};

describe(render, () => {
  it('excludes the record for undefined, null and false', () => {
    expect(render(undefined, 'line', options)).toBeUndefined();
    expect(render(null, 'line', options)).toBeUndefined();
    expect(render(false, 'line', options)).toBeUndefined();
  });

  it('keeps the original record for true', () => {
    expect(render(true, 'line', options)).toBe('line');
  });

  it('prints empty strings and zeros rather than excluding them', () => {
    expect(render('', 'line', options)).toBe('');
    expect(render(0, 'line', options)).toBe('0');
  });

  it('tests a RegExp against the record', () => {
    expect(render(/in/, 'line', options)).toBe('line');
    expect(render(/out/, 'line', options)).toBeUndefined();
    const global = /i/g;
    expect(render(global, 'line', options)).toBe('line');
    expect(render(global, 'line', options)).toBe('line');
  });

  it('inverts the selection', () => {
    const inverted = { ...options, invert: true };
    expect(render(/out/, 'line', inverted)).toBe('line');
    expect(render('replacement', 'line', inverted)).toBeUndefined();
  });

  it('joins iterables with the output field separator', () => {
    expect(render(['a', 1, null], 'line', options)).toBe('a 1 ');
    expect(render(new Set(['a', 'b']), 'line', options)).toBe('a b');
    expect(
      render(['a', 'b'], 'line', { ...options, outputFieldSeparator: ',' }),
    ).toBe('a,b');
  });

  it('prints rows of columns in slurp mode', () => {
    expect(
      render(
        [
          ['a', 'b'],
          ['c', 'd'],
        ],
        'input',
        { ...options, slurp: true },
      ),
    ).toBe('a b\nc d');
  });

  it('prints plain objects as JSON and other objects as text', () => {
    expect(render({ a: [1] }, 'line', options)).toBe('{"a":[1]}');
    expect(render(new URL('https://example.com'), 'line', options)).toBe(
      'https://example.com/',
    );
  });

  it('prints JSON', () => {
    const json = { ...options, json: true };
    expect(render('a', 'line', json)).toBe('"a"');
    expect(render(true, 'line', json)).toBe('"line"');
    expect(render(new Map([['a', 1n]]), 'line', json)).toBe('{"a":"1"}');
    expect(render([1], 'line', { ...json, slurp: true })).toBe('[\n  1\n]');
  });
});
