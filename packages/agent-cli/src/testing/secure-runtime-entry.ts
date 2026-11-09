/** Test-only source entry: exercise the real startup with secure mode enabled for this runtime. */
import { startCliEntry } from '../cli-entry.js';
import { overrideProductSecureMode } from '../product/session-sealing.js';
import { resolveCliRuntimeContext } from '../startup/product-bootstrap.js';

const runtime = resolveCliRuntimeContext({ environment: process.env });
overrideProductSecureMode(runtime, true);
await startCliEntry({ productRuntime: runtime });
