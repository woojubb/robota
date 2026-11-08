/**
 * `@robota-sdk/agent-tool-defaults` — the SDK's built-in default tool set, as a composition leaf.
 *
 * WHOSE defaults: the agent runtime SDK's own — the tools every product session gets unless the
 * composition root supplies its own list. It composes ONE lower-layer package (`agent-tools`); it does
 * not bundle same-level `agent-tool-*` siblings, so it is not an aggregator in the project-structure sense
 * and keeps its name. Only the description had to say whose.
 *
 * Import this at a composition root. It is deliberately NOT re-exported by
 * `@robota-sdk/agent-framework`: a pass-through re-export would restore the very route that was
 * closed, and the project-structure rules ban it independently.
 */
export { createDefaultTools } from './create-default-tools.js';
export type { ICreateDefaultToolsOptions } from './create-default-tools.js';
