#!/usr/bin/env node
/**
 * Robota CLI binary entry point.
 *
 * Boots the CLI and handles any uncaught top-level errors gracefully.
 *
 * A Node.js version check (>=22) is injected as a build-time banner in
 * tsdown.config.ts and runs before any module imports are loaded.
 */
import { startCli } from './cli.js';
import { areTuiProcessGuardsActive } from './process-guards.js';

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
    process.stderr.write(
      '\n[robota] CJK/IME input error — this is a known issue with macOS Terminal.app.\n' +
        '  Workaround: use iTerm2 (https://iterm2.com) or input your prompt in English.\n' +
        '  Alternatively, use headless mode: robota -p "your prompt here"\n\n',
    );
    return;
  }
  // ERR-001 G1: in interactive TUI mode the product-level guards own process survival —
  // they render the error into the live session; re-throwing here would kill the TUI.
  if (areTuiProcessGuardsActive()) return;
  // Re-throw non-IME errors — headless/print mode keeps normal crash behavior
  throw err;
});

startCli().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message + '\n');
  process.exit(1);
});
