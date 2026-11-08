/**
 * `@robota-sdk/agent-tools/defaults` — the SDK's built-in default tool set, as a composition leaf.
 *
 * WHOSE defaults: the agent runtime SDK's own — the tools every product session gets unless the
 * composition root supplies its own list. It composes only the tool factories of the neutral and
 * `./node` entries of this package, and implements no tool itself.
 *
 * Import this at a composition root. It is deliberately NOT re-exported by
 * `@robota-sdk/agent-framework`: a pass-through re-export would restore the very route that was
 * closed, and the project-structure rules ban it independently.
 */
export { createDefaultTools } from './create-default-tools.js';
export type { ICreateDefaultToolsOptions } from './create-default-tools.js';
