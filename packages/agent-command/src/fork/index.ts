/**
 * Only the module factory leaves this directory — the same rule the sibling `src/peers/` follows.
 *
 * `executeForkCommand`, `parseForkArgs` and `ForkCommandSource` are how the module is BUILT, not how
 * it is used: `/fork` is registered by default, so nothing outside constructs one. Exporting them
 * would add entries to this package's frozen undocumented-surface count for a reach nobody asked for.
 */
export { createForkCommandModule } from './fork-command-module.js';
