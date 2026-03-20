#!/usr/bin/env node
/**
 * Robota CLI binary entry point.
 *
 * Boots the CLI and handles any uncaught top-level errors gracefully.
 */
import { startCli } from './cli.js';

// Last-resort crash prevention — catches errors from IME/rendering that
// escape React/Ink error boundaries (e.g., Korean IME in raw mode).
process.on('uncaughtException', (err) => {
  // Silently ignore IME-related errors to keep the CLI alive.
  // Log to stderr for debugging but do not exit.
  process.stderr.write(`[robota] uncaught: ${err.message}\n`);
});

startCli().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message + '\n');
  process.exit(1);
});
