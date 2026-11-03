#!/usr/bin/env node
/** The Node version banner is injected before imports by the CLI build. */
import { startCliEntry } from './cli-entry.js';
import { hardenProductProcess } from './process-hardening.js';

// This executable's policy, not the public entry's: a host embedding `startCliEntry` keeps its own
// process as it is. The npm wrapper already did this before loading the bundle; the compiled binary
// and source runs start here, and so does every daemon or worker child they re-execute.
hardenProductProcess();
void startCliEntry();
