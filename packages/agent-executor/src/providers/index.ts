// ARCH-111: the two `agent-core`-owned helpers are not surfaced here. `agent-core` is their owner and
// their only exporter; the profile helpers below are this package's own.
export {
  createProviderFromExactProfile,
  createProviderFromProfile,
  resolveProfileApiKey,
} from './provider-factory.js';
export {
  TRANSPORT_ENVIRONMENT,
  connectionEnvironmentNames,
  findConnectionEnvironmentDivergence,
  sealConnectionEnvironment,
  verifyConnectionEnvironment,
} from './connection-environment.js';
export type { IConnectionEnvironmentCheck } from './connection-environment.js';
