/**
 * `@robota-sdk/agent-tool-defaults` — the default tool set, as a composition leaf.
 *
 * Import this at a composition root. It is deliberately NOT re-exported by
 * `@robota-sdk/agent-framework`: a pass-through re-export would restore the very route ARCH-035
 * closed, and STRUCT-07 bans it independently.
 */
export { createDefaultTools } from './create-default-tools.js';
export type { ICreateDefaultToolsOptions } from './create-default-tools.js';
