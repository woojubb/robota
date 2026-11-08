/**
 * Only the module factory leaves this directory.
 *
 * `executePeersCommand`, `PeersCommandSource` and `createPeersCommandEntry` are how the module is
 * BUILT, not how it is used: the command is registered by default, so nothing outside constructs one.
 * Exporting them would have added four entries to this package's frozen undocumented-surface count —
 * debt that may shrink and never grow — in exchange for a reach nobody asked for.
 */
export { createPeersCommandModule } from './peers-command-module.js';
