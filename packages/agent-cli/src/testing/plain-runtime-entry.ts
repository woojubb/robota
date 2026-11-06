/** Test-only source entry for the adversary's plain-runtime negative control. */
import { startCliEntry } from '../cli-entry.js';
import { resolveCliRuntimeContext } from '../startup/product-bootstrap.js';

const runtime = resolveCliRuntimeContext({ environment: process.env });
await startCliEntry({ productRuntime: runtime });
