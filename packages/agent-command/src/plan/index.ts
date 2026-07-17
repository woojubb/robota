/**
 * SELFHOST-002: `/plan` explicit plan-mode command.
 *
 * Only the module factory is a package-entry export (matching the other command modules — sources,
 * command handlers, and descriptions stay internal, imported by direct path). This keeps the
 * package's public surface minimal and its SPEC Public API table in sync.
 */

export { createPlanCommandModule } from './plan-command-module.js';
