#!/usr/bin/env node
/**
 * Robota CLI binary entry point.
 *
 * Boots the CLI and handles any uncaught top-level errors gracefully.
 */
import { startCli } from './cli.js';

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

startCli().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message + '\n');
  process.exit(1);
});
