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
  // Re-throw non-IME errors — let them crash normally
  throw err;
});

// Warn on macOS Terminal.app before starting (only in interactive/TUI mode)
if (
  process.platform === 'darwin' &&
  process.env.TERM_PROGRAM === 'Apple_Terminal' &&
  process.stdin.isTTY
) {
  process.stderr.write(
    '\n⚠  macOS Terminal.app: CJK/IME input may be unstable in interactive mode.\n' +
      '   Recommendation: use iTerm2 (https://iterm2.com) or headless mode (-p flag).\n\n',
  );
}

startCli().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message + '\n');
  process.exit(1);
});
