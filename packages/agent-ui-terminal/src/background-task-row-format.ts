import { formatCountdown } from './attention/countdown.js';
import { formatExecutionWorkspaceEntryRow } from './execution-workspace-view-model.js';
import { STATUS_GLYPH, workspaceStatusKind } from './status-glyph.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';

/**
 * The row's leading connector. CLI-2004 adds the plain form: `├`/`└` draw a tree a sighted reader
 * follows at a glance and a screen reader announces as two more characters per row.
 */
export const BACKGROUND_TASK_CONNECTORS = { branch: '├', last: '└', plain: '-' } as const;

export type TBackgroundTaskConnector =
  (typeof BACKGROUND_TASK_CONNECTORS)[keyof typeof BACKGROUND_TASK_CONNECTORS];

export interface IBackgroundTaskRow {
  connector: TBackgroundTaskConnector;
  /** Shared status glyph (⟳ running, ✓ done, ✗ failed, …) — see status-glyph.ts. */
  marker: string;
  /** SCREEN-1992: the five-word state beside the glyph — the word a reader hears, not a colour. */
  state: string;
  color: string;
  label: string;
  segments: string[];
  preview?: string;
  /** SCREEN-1992: the entry's headline when it says more than the preview already does. */
  headline?: string;
  /** SCREEN-1992: `in 59s` while a schedule sleeps — rendered against `options.now`. */
  countdown?: string;
  accessibleText: string;
}

export interface IBackgroundTaskRowOptions {
  isLast?: boolean;
  /** Screen-reader mode ⇒ the plain connector. */
  screenReader?: boolean;
  /** The clock the countdown is rendered against; the panel's tick advances it. */
  now?: Date;
}

/** The headline earns its place only when the row does not already say it (preview or subtitle). */
function resolveHeadline(
  entry: IExecutionWorkspaceEntry,
  preview: string | undefined,
  subtitle: string | undefined,
): string | undefined {
  const text = entry.headline?.text;
  if (text === undefined || text.length === 0 || text === preview) return undefined;
  if (subtitle !== undefined && subtitle.includes(text)) return undefined;
  return entry.headline?.kind === 'question' ? `? ${text}` : text;
}

function resolveConnector(options: IBackgroundTaskRowOptions): TBackgroundTaskConnector {
  if (options.screenReader === true) return BACKGROUND_TASK_CONNECTORS.plain;
  return options.isLast === false
    ? BACKGROUND_TASK_CONNECTORS.branch
    : BACKGROUND_TASK_CONNECTORS.last;
}

export function formatBackgroundTaskRow(
  entry: IExecutionWorkspaceEntry,
  options: IBackgroundTaskRowOptions = {},
): IBackgroundTaskRow {
  const row = formatExecutionWorkspaceEntryRow(entry);
  // Symbol from the same (status, attention) classification that drives row.color,
  // so the marker's glyph and colour always agree (SCREEN-007).
  const marker = STATUS_GLYPH[workspaceStatusKind(entry.status, entry.attention)].symbol;
  const segments = [row.statusLabel, row.subtitle].filter(
    (segment): segment is string => typeof segment === 'string' && segment.length > 0,
  );
  const connector = resolveConnector(options);
  const headline = resolveHeadline(entry, row.preview, row.subtitle);
  const countdown =
    entry.nextFireAt === undefined
      ? undefined
      : formatCountdown(entry.nextFireAt, options.now ?? new Date());
  return {
    connector,
    marker,
    state: entry.state,
    color: row.color,
    label: row.title,
    segments,
    preview: row.preview,
    headline,
    countdown,
    accessibleText: [
      `${connector} ${marker} ${entry.state} ${row.title}`,
      ...segments,
      headline,
      row.preview,
      countdown,
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' · '),
  };
}
