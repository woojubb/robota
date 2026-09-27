/**
 * Derives the one deliberate, content-carrying field of the personal-usage report: a short,
 * recognizable label for a session that contributed usage in the reported period, built from data
 * the report builder already reads (it opens no new record access). `summarizePersonalUsage` calls
 * this only for sessions that ended up in `totals.sessions`, so a session outside the period never
 * gets a label — and never leaks so much as its `cwd` basename to a report about the days it wasn't
 * part of.
 */

import type { IPersonalUsageSessionLabel } from '@robota-sdk/agent-interface-analytics';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

/** Long enough to recognize a session, short enough that it stays a label, not a quote. */
const TITLE_MAX_LENGTH = 60;
const ELLIPSIS = '…';

function truncateTitle(value: string): string {
  if (value.length <= TITLE_MAX_LENGTH) return value;
  return `${value.slice(0, TITLE_MAX_LENGTH - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

/** The session's own name, else one line from its first request, else a plain placeholder. */
function sessionTitle(record: IInteractiveSessionRecord): string {
  const name = record.name?.trim();
  if (name) return truncateTitle(name);
  const firstUserMessage = record.messages?.find((message) => message.role === 'user');
  const firstLine = firstUserMessage?.content.split('\n', 1)[0]?.trim();
  if (firstLine) return truncateTitle(firstLine);
  return 'Untitled session';
}

/** The last path segment of `cwd`, so a report never carries a person's full directory layout. */
function workspaceBasename(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const trimmed = cwd.replace(/[\\/]+$/, '');
  const base = trimmed.split(/[\\/]/).at(-1);
  return base && base.length > 0 ? base : undefined;
}

export function buildSessionLabels(
  records: readonly IInteractiveSessionRecord[],
  sessionIds: ReadonlySet<string>,
): Record<string, IPersonalUsageSessionLabel> {
  const labels: Record<string, IPersonalUsageSessionLabel> = {};
  for (const record of records) {
    if (!sessionIds.has(record.id)) continue;
    const workspace = workspaceBasename(record.cwd);
    labels[record.id] = { title: sessionTitle(record), ...(workspace ? { workspace } : {}) };
  }
  return labels;
}
