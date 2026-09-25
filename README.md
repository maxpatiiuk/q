# ni

AWK with modern syntax. Process text line by line with JavaScript expressions.

A better version of [nip](https://github.com/kolodny/nip). Zero runtime
dependencies.

```sh
# Transform each line (the last expression is the output)
ls | ni 'l.toUpperCase()'

# Filter: return a boolean, or a falsy value to exclude the line
ls | ni 'l.includes("zsh")'
ls | ni 'l.test(/zsh/)'

# Shorthand: a regular expression filters lines, like grep
ls | ni '/zsh/'
ls | ni -v '/zsh/'

# Extract
ls | ni 'l.match(/z(s+)h/)?.[1]'

# Columns (like AWK's $1, $2, ... but 0-based)
ps aux | ni 'c[10]'
ni -F, 'c.slice(0, 2)' data.csv

# Process the whole input at once
ls | ni -1 'l.split("\n").reverse()'
ls | ni -1 'lines.toSorted().toReversed()'

# Setup and summary (variables from --begin are visible everywhere)
ni -b 'let sum = 0' 'sum += +c[2];' -e 'sum' data.txt
ni -b 'console.log("start")' 'let t = c[0]; `${t}${c[2]}`' -e 'console.log("end")'

# JSON in, JSON out
curl -s https://api.github.com/repos/nodejs/node | ni -1J 'l.stargazers_count'
cat events.ndjson | ni -Jj '({ type: l.type, at: l.created_at })'
```

## Install

```sh
pnpm add -g @maxpatiiuk/ni
```

Requires Node.js 22+.

## Output rules

The value of the last expression replaces the line:

| Value                        | Output                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| string, number, ...          | printed as is (including `""` and `0`)                           |
| `true`                       | the original line                                                |
| `undefined`, `null`, `false` | nothing (the line is excluded)                                   |
| `RegExp`                     | the original line if the regex matches it                        |
| array, Set, generator...     | items joined by spaces (in `-1` mode: by newlines; nested: rows) |
| plain object                 | JSON                                                             |
| Promise                      | awaited, then printed by the rules above                         |

- The code is a function body: statements are allowed, and the last expression
  statement is returned implicitly (`let t = c[0]; t + c[2]`).
- Like in Rust, a trailing semicolon opts out of the implicit return:
  `ni 'console.log(l);'`. `return` works too.
- `await` works anywhere.
- Like AWK, code runs in sloppy mode, so assigning to an undeclared variable
  creates a global that persists across lines:
  `ni -b 'seen = new Set()' '!seen.has(l) && !!seen.add(l)'` (deduplicate).
- `console.log()` output stays in order with the regular output.

## Variables

| Name           | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| `l`, `line`    | current line (the whole input in `-1` mode; parsed JSON with `-J`) |
| `i`, `index`   | 0-based line index across all inputs (AWK's `NR - 1`)              |
| `c`, `columns` | line split into columns (see `-F`); in `-1` mode: an array of rows |
| `f`, `file`    | current file name (`-` for stdin)                                  |
| `lines`        | array of all lines (`-1` mode only)                                |

`String.prototype.test(regexOrString)` is added for convenience, so that
`l.test(/re/)` reads left to right.

## Options

Flags follow grep and AWK where they have an equivalent:

| Flag                         | Origin  | Meaning                                                           |
| ---------------------------- | ------- | ----------------------------------------------------------------- |
| `-b, --begin <code>`         | `BEGIN` | run before reading input (repeatable)                             |
| `-e, --end <code>`           | `END`   | run after reading input; its value is printed                     |
| `-f, --file <file>`          | both    | read the code from a file                                         |
| `-F, --field-separator <fs>` | AWK     | column separator (see below)                                      |
| `-v, --invert-match`         | grep    | print the lines that the code excludes                            |
| `-c, --count`                | grep    | print only the number of selected lines                           |
| `-m, --max-count <n>`        | grep    | stop after `n` selected lines                                     |
| `-n, --line-number`          | grep    | prefix output with the 1-based line number (per file)             |
| `-H, --with-filename`        | grep    | prefix output with the file name                                  |
| `-q, --quiet`                | grep    | print nothing, exit on the first selected line                    |
| `-z, --null-data`            | grep    | records are NUL-separated (pairs with `find -print0`)             |
| `--rs`, `--ors`, `--ofs`     | AWK     | input record, output record, and output field separators          |
| `-1, --slurp`                | nip     | run the code once for the whole input                             |
| `-j, --json`                 |         | print results as JSON (one per line; pretty-printed in `-1` mode) |
| `-J, --json-input`           |         | parse each line (the whole input in `-1` mode) as JSON            |

Field separator (`-F`), as in AWK: `" "` (default) splits on runs of whitespace
and ignores leading/trailing whitespace; a single character is literal; longer
values are regular expressions. `/regex/flags` works too. Escapes such as `\t`
are interpreted.

Exit status, as in grep: `0` if any line was selected (or `--end` printed
something), `1` otherwise, `2` on error. Files that can't be read are reported
and skipped.

## Development

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc
pnpm build       # emits dist/
node src/cli.ts 'l.toUpperCase()' < README.md  # run from source
```

## Architecture

- [src/cli.ts](./src/cli.ts): entry point
- [src/run.ts](./src/run.ts): reads inputs and drives the program
- [src/compile.ts](./src/compile.ts): turns code into a function with an
  implicit return, sharing scope between `--begin`, the code, and `--end`
- [src/render.ts](./src/render.ts): turns return values into output
- [src/options.ts](./src/options.ts): command-line options and help
