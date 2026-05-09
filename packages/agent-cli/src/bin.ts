#!/usr/bin/env node
/**
 * Robota CLI binary entry point.
 *
 * Boots the CLI and handles any uncaught top-level errors gracefully.
 *
 * NOTE: Node.js version check and Terminal.app warning are injected as a
 * build-time banner in tsup.config.ts, ensuring they execute before any
 * ESM module is loaded (static imports are hoisted by the JS engine).
 */
import { startCli } from './cli.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';

// Last-resort crash prevention for IME-related errors only.
// Korean IME in raw mode can cause errors that escape React/Ink.
// Non-IME errors are re-thrown to preserve normal crash behavior.
process.on('uncaughtException', (err) => {
  const msg = err.message ?? '';
  const isLikelyIME =
    msg.includes('string-width') ||
    msg.includes('setCursorPosition') ||
    msg.includes('getStringWidth') ||
    msg.includes('slice') ||
    msg.includes('charCodeAt');
  if (isLikelyIME) {
    process.stderr.write(`[robota] IME error suppressed: ${msg}\n`);
    return;
  }
  // Re-throw non-IME errors — let them crash normally
  throw err;
});

startCli().catch((err: Error | TUniversalValue) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message + '\n');
  process.exit(1);
});
