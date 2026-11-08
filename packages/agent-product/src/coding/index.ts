/**
 * @robota-sdk/agent-product/coding — agent's coding capability as a single `ICapabilityPack`. The additive-axis
 * proof and agent's first capability pack: bundles the built-in coding tools, the coding
 * command modules (`/shell`, `/editor`, `/git`), and the coding subagents (`general-purpose`, `Explore`, `Plan`).
 *
 * The pack is built by a FACTORY that takes the session's working directory — there is deliberately no
 * context-free constant, because a pack whose file tools carry no `cwd` had a disarmed working-directory
 * path guard (the guard itself is fail-closed now). See `createCodingPack`.
 */

export { createCodingPack } from './coding-pack.js';
export type { ICodingPackOptions } from './coding-pack.js';
