import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

/**
 * The identity and handshake tests run hundreds of WebCrypto operations (key generation, signing,
 * verification) through the thread pool, and what they cost depends on how busy the machine is. Alone
 * on a Windows runner the identity-chain file takes about 0.6 s; in a run where many suites share the
 * runner the same file took 9 s and its case that loops over malformed inputs passed vitest's 5 s
 * default, three runs in a row. Windows gets the bound the other file-heavy packages use.
 */
const WEBCRYPTO_TEST_TIMEOUT_MS = process.platform === 'win32' ? 30_000 : 5_000;

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      globals: true,
      environment: 'node',
      testTimeout: WEBCRYPTO_TEST_TIMEOUT_MS,
      hookTimeout: WEBCRYPTO_TEST_TIMEOUT_MS,
    },
  }),
);
