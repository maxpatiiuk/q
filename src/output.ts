import { once } from 'node:events';
import type { Writable } from 'node:stream';
import { format } from 'node:util';

export type Output = {
  readonly write: (text: string) => void;
  /** Defined while the destination asks to hold off on writing more */
  readonly drained: () => Promise<void> | undefined;
  readonly flush: () => Promise<void>;
  /**
   * Writes into the same buffer, so that `console.log()` output from user
   * code stays in order with the regular output.
   */
  readonly console: Console;
};

/**
 * Buffers output to avoid a syscall per record, while respecting the
 * destination's backpressure.
 */
export function createOutput(
  destination: Writable,
  bufferSize = 1 << 16,
): Output {
  let buffer: string[] = [];
  let bufferLength = 0;
  let pending: Promise<void> | undefined;

  function flushBuffer(): void {
    if (buffer.length === 0) {
      return;
    }
    const canContinue = destination.write(buffer.join(''));
    buffer = [];
    bufferLength = 0;
    if (!canContinue) {
      pending ??= once(destination, 'drain').then(() => {
        pending = undefined;
      });
    }
  }

  function write(text: string): void {
    buffer.push(text);
    bufferLength += text.length;
    if (bufferLength >= bufferSize) {
      flushBuffer();
    }
  }

  return {
    write,
    drained: () => pending,
    async flush() {
      flushBuffer();
      await pending;
    },
    console: createConsole(write),
  };
}

/**
 * A console whose stdout methods write to the output buffer. Cheaper at
 * startup than `new Console()`. Other methods, like `console.error()`, are
 * the global ones.
 */
function createConsole(write: (text: string) => void): Console {
  const log = (...data: readonly unknown[]): void => {
    write(`${format(...data)}\n`);
  };
  return { ...globalThis.console, log, info: log, debug: log };
}
