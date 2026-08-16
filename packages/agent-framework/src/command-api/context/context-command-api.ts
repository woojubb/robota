import { AUTO_COMPACT_THRESHOLD } from '@robota-sdk/agent-session';

import type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../../context/context-reference-inventory.js';
import type { ICommandSettingsAdapter, ICommandSettingsDocument } from '../host-adapters.js';
import type {
  ICommandHostAdapterAccess,
  ICommandHostContextReferences,
  ICommandHostContextWindow,
  ICommandHostSessionAccess,
} from '../host-context.js';
import type { TAutoCompactThresholdSource } from '../host-context.js';
import type { IContextWindowState } from '@robota-sdk/agent-core';
export type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../../context/context-reference-inventory.js';

export type TAutoCompactThreshold = number | false;

export const DEFAULT_AUTO_COMPACT_THRESHOLD = AUTO_COMPACT_THRESHOLD;
export const AUTO_COMPACT_THRESHOLD_SETTINGS_KEY = 'autoCompactThreshold';

export interface ICompactContextResult {
  before: IContextWindowState;
  after: IContextWindowState;
  beforeMessageCount: number;
  afterMessageCount: number;
}

/** Read context-window state through the command host facade. */
export function readCommandContextState(context: ICommandHostContextWindow): IContextWindowState {
  return context.getContextState();
}

/** Read the effective automatic compact policy through the command host facade. */
export function readAutoCompactThreshold(
  context: ICommandHostContextWindow,
): TAutoCompactThreshold {
  return context.getAutoCompactThreshold();
}

/** Read the source of the effective automatic compact policy. */
export function readAutoCompactThresholdSource(
  context: ICommandHostContextWindow,
): TAutoCompactThresholdSource {
  return context.getAutoCompactThresholdSource();
}

/** Update the active session's automatic compact policy through the command host facade. */
export function setCommandAutoCompactThreshold(
  context: ICommandHostContextWindow & ICommandHostSessionAccess,
  threshold: TAutoCompactThreshold,
  source: TAutoCompactThresholdSource,
): void {
  if (context.setAutoCompactThreshold) {
    context.setAutoCompactThreshold(threshold, source);
    return;
  }

  const session = context.getSession();
  if (!session.setAutoCompactThreshold) {
    throw new Error('Command host does not support changing auto-compact threshold.');
  }
  session.setAutoCompactThreshold(threshold);
}

/** Persist an automatic compact policy value through the host settings adapter, when present. */
export function writeAutoCompactThresholdSetting(
  context: ICommandHostAdapterAccess,
  threshold: TAutoCompactThreshold,
): boolean {
  const settings = getSettingsAdapter(context);
  if (!settings) return false;

  settings.write({
    ...settings.read(),
    [AUTO_COMPACT_THRESHOLD_SETTINGS_KEY]: threshold,
  });
  return true;
}

/** Remove the persisted automatic compact policy through the host settings adapter, when present. */
export function resetAutoCompactThresholdSetting(context: ICommandHostAdapterAccess): boolean {
  const settings = getSettingsAdapter(context);
  if (!settings) return false;

  const next: ICommandSettingsDocument = { ...settings.read() };
  delete next[AUTO_COMPACT_THRESHOLD_SETTINGS_KEY];
  settings.write(next);
  return true;
}

/** Run manual compaction through the command host facade and return before/after state. */
export async function compactCommandContext(
  context: ICommandHostContextWindow & ICommandHostSessionAccess,
  instructions?: string,
): Promise<ICompactContextResult> {
  const before = readCommandContextState(context);
  const beforeMessageCount = context.getSession().getMessageCount();
  await context.compactContext(instructions);
  const after = readCommandContextState(context);
  const afterMessageCount = context.getSession().getMessageCount();
  return { before, after, beforeMessageCount, afterMessageCount };
}

/** List context reference inventory entries through the command host facade. */
export function listCommandContextReferences(
  context: ICommandHostContextReferences,
): IContextReferenceItem[] {
  return context.listContextReferences();
}

/** Add a manual context reference through the command host facade. */
export async function addCommandContextReference(
  context: ICommandHostContextReferences,
  path: string,
): Promise<IContextReferenceAddResult> {
  if (!context.addContextReference) {
    return {
      evicted: [],
      diagnostics: ['Command host does not support context reference additions.'],
    };
  }
  return context.addContextReference(path);
}

/** Remove a context reference through the command host facade. */
export function removeCommandContextReference(
  context: ICommandHostContextReferences,
  path: string,
): IContextReferenceRemoveResult {
  return context.removeContextReference?.(path) ?? {};
}

/** Clear all context references through the command host facade. */
export function clearCommandContextReferences(
  context: ICommandHostContextReferences,
): IContextReferenceClearResult {
  return context.clearContextReferences();
}

function getSettingsAdapter(
  context: ICommandHostAdapterAccess,
): ICommandSettingsAdapter<ICommandSettingsDocument> | undefined {
  return context.getCommandHostAdapters?.().settings;
}
