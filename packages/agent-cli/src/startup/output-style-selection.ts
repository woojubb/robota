import type { IOutputStyle, IOutputStyleRegistry } from '@robota-sdk/agent-preset';
import type { TSettingsData } from '@robota-sdk/agent-framework';

import type { IParsedCliArgs } from '../utils/cli-args.js';

/** CLI-1988: --output-style wins over the persisted user selection, then the neutral default. */
export function selectOutputStyleId(
  args: Pick<IParsedCliArgs, 'outputStyle'>,
  settingsOutputStyle: TSettingsData['outputStyle'],
): string {
  return (
    args.outputStyle ??
    (typeof settingsOutputStyle === 'string' && settingsOutputStyle.length > 0
      ? settingsOutputStyle
      : 'default')
  );
}

/** Resolve the selected id once against the startup registry, with an actionable terminal error. */
export function resolveOutputStyle(registry: IOutputStyleRegistry, id: string): IOutputStyle {
  const style = registry.getOutputStyle(id);
  if (style) return style;
  const available = registry
    .listOutputStyles()
    .map((entry) => entry.id)
    .join(', ');
  throw new Error(`Unknown output style "${id}". Available: ${available || '(none)'}`);
}
