#!/usr/bin/env node
import { run } from './run.ts';

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  // Downstream stopped reading (e.g. `ni ... | head`). That is not an error
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

process.exitCode = await run({
  args: process.argv.slice(2),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
