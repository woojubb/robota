#!/usr/bin/env node
// Runs the built control plane with plain node; it has no runtime dependencies.
import { main } from '../dist/main.mjs';

try {
  process.exitCode = await main(process.argv.slice(2), process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
