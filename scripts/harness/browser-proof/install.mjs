/**
 * Imported first by every proof bundle, so the stub is the page's `fetch` before any library's
 * module code runs: a library that reads `fetch` while it loads finds the stub, as it finds the
 * browser's own in a page.
 */
import { createFetchStub } from './fetch-stub.mjs';

export const stub = createFetchStub();
globalThis.fetch = stub.fetch;
