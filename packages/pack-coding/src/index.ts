/**
 * @robota-sdk/pack-coding — robota's coding capability as a single `ICapabilityPack`. The additive-axis
 * proof for ARCH-005 and robota's first capability pack: bundles the built-in coding tools, the coding
 * command modules (`/shell`, `/editor`), and the coding subagents (`general-purpose`, `Explore`, `Plan`).
 *
 * The pack is built by a FACTORY that takes the session's working directory — there is deliberately no
 * context-free constant, because a pack whose file tools carry no `cwd` has a disarmed working-directory
 * path guard (ARCH-006). See `createCodingPack`.
 */

export { createCodingPack } from './coding-pack.js';
export type { ICodingPackOptions } from './coding-pack.js';
