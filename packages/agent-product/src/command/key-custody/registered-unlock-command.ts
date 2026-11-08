/**
 * Whether a refusal for locked keys can name `/unlock`. The host registers `/unlock` only where it
 * holds keys it can unlock (the key custody module exists only with that port), so a command learns
 * from the host's own catalog whether the person can run it, and names it exactly then; elsewhere the
 * refusal keeps its plain words.
 */
import type { ICommandHostCatalog } from '@robota-sdk/agent-framework';

/** `/unlock` when `catalog` registered it, else `undefined`. A narrow host with no catalog has none. */
export function registeredUnlockCommand(
  catalog: Partial<Pick<ICommandHostCatalog, 'listCommands'>>,
): string | undefined {
  return catalog.listCommands?.().some((entry) => entry.name === 'unlock') === true
    ? '/unlock'
    : undefined;
}
