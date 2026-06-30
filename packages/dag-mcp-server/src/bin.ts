#!/usr/bin/env node

import { runDagMcpServer } from './runner.js';

runDagMcpServer(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
