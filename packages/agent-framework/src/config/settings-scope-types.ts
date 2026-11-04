/**
 * Leaf type module for the settings scopes.
 *
 * Split out of `settings-source.ts` so a file that only needs a scope name does not import the
 * source module (which imports the workspace project reader) — that previously created an import
 * cycle between the two.
 */
export type THostSettingsScope = 'managed' | 'user';

/** CLI-selectable settings write scope; project-local still requires an authorized project store. */
export type TSettingsScope = 'user' | 'project-local';
