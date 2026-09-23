import type { IDagDefinition } from '../types/domain.js';

/** One definition identity with its latest version and distinct statuses. */
export interface IDagDefinitionSummary {
  readonly dagId: string;
  readonly latestVersion: number;
  readonly statuses: IDagDefinition['status'][];
}

export function summarizeDagDefinitions(
  definitions: readonly IDagDefinition[],
): IDagDefinitionSummary[] {
  const items = new Map<string, IDagDefinitionSummary>();
  for (const definition of definitions) {
    const existing = items.get(definition.dagId);
    if (!existing) {
      items.set(definition.dagId, {
        dagId: definition.dagId,
        latestVersion: definition.version,
        statuses: [definition.status],
      });
      continue;
    }
    items.set(definition.dagId, {
      dagId: definition.dagId,
      latestVersion: Math.max(existing.latestVersion, definition.version),
      statuses: existing.statuses.includes(definition.status)
        ? existing.statuses
        : [...existing.statuses, definition.status],
    });
  }
  return [...items.values()].sort((a, b) => a.dagId.localeCompare(b.dagId));
}
