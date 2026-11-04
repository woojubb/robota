import type { TEnvResolver } from './env-resolver.js';

/** The host process environment. A Node composition root injects it; a test injects a record. */
export const processEnvResolver: TEnvResolver = (name) => process.env[name];
