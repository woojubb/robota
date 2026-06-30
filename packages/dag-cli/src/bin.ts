#!/usr/bin/env node
import { runDagCli } from './runner.js';
import { FAILURE_EXIT_CODE } from './types.js';

const USER_ARGUMENT_START_INDEX = 2;

runDagCli(process.argv.slice(USER_ARGUMENT_START_INDEX))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: Error | string | number | boolean | null | object) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = FAILURE_EXIT_CODE;
  });
