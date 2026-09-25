import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('cli.ts', import.meta.url));

const ni = (command: string) =>
  spawnSync('sh', ['-c', command], {
    encoding: 'utf8',
    env: { ...process.env, NI: `${process.execPath} ${cli}` },
  });

describe('cli', () => {
  it('reads stdin and sets the exit code', () => {
    const result = ni('printf "a\\nb\\n" | $NI "/b/"');
    expect(result.stdout).toBe('b\n');
    expect(result.status).toBe(0);
    expect(ni('printf "a\\n" | $NI "/b/"').status).toBe(1);
  });

  it('exits quietly when the downstream closes the pipe', () => {
    const result = ni('seq 1 200000 | $NI "l" | head -n 1');
    expect(result.stdout).toBe('1\n');
    expect(result.stderr).toBe('');
  });
});
