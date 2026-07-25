/**
 * @robota-sdk/agent-product — the product-assembly kernel.
 *
 * `assembleProduct(profile)` is a PURE, deterministic, IO-free fold over `IProductProfile` DATA with ZERO
 * product-specific branching — the composition mechanism a third party imports to build their OWN product
 * on Robota's published runtime. It resolves presets via a per-call instance-scoped registry, merges
 * additive capability packs, and DELEGATES runtime construction to `agent-framework`'s `buildRuntimeSession`
 * seam. It never imports a concrete transport, the TUI, or the CLI; those are injected via the profile.
 */

export { assembleProduct } from './assemble-product.js';

export type { IProductProfile, IAssembledProduct, IBuildRuntimeInput } from './product-profile.js';
