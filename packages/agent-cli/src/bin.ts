#!/usr/bin/env node
/**
 * Robota CLI binary entry point.
 *
 * Boots the CLI and handles any uncaught top-level errors gracefully.
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

// Node.js version check
const REQUIRED_NODE_MAJOR = 22;
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (nodeMajor < REQUIRED_NODE_MAJOR) {
  process.stderr.write(
    `\n  Robota requires Node.js ${REQUIRED_NODE_MAJOR} or higher.\n` +
      `  Current version: ${process.versions.node}\n\n` +
      `  Upgrade options:\n` +
      `    nvm: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}\n` +
      `    Download: https://nodejs.org/en/download\n\n`,
  );
  process.exit(1);
}

// macOS Terminal.app CJK crash warning
if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
  process.stderr.write(
    `\n  ⚠️  Warning: macOS Terminal.app detected.\n` +
      `  CJK input (Korean/Chinese/Japanese) may cause crashes.\n` +
      `  Recommended: use iTerm2 or another terminal emulator.\n\n`,
  );
}

startCli().catch((err: Error | TUniversalValue) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message + '\n');
  process.exit(1);
});
