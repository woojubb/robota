import type { IPreset } from '../preset-types.js';

/**
 * The neutral baseline preset. It carries NO option overrides so that resolving it is a
 * pure no-op — applying `default` reproduces the standard agent behaviour exactly (no regression).
 * The default agent identity is owned by `DEFAULT_AGENT_NAME` in `resolve-preset.ts`, not here,
 * so that this preset stays a true identity element under merging.
 */
export const defaultPreset: IPreset = {
  id: 'default',
  title: 'Default',
  description: 'Neutral baseline preset — no overrides; reproduces the standard agent behaviour.',
};
