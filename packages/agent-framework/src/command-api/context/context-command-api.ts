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

// Issue #2052: owned by agent-session (`ContextWindowTracker`), not redeclared here.
import type { TAutoCompactThreshold } from '@robota-sdk/agent-session';

export type { TAutoCompactThreshold };

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
  context: ICommandHostContextWindow,
  threshold: TAutoCompactThreshold,
  source: TAutoCompactThresholdSource,
): void {
  // ARCH-029 TC-09: one path. The branch this replaced fell back to
  // `getSession().setAutoCompactThreshold(threshold)` when the host member was absent — and the two
  // were NOT the same operation: the fallback silently dropped `source`, so a session-scoped change
  // was recorded as whatever the reader assumed. Exactly the `clearConversationHistory` shape.
  context.setAutoCompactThreshold(threshold, source);
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
  return context.addContextReference(path);
}

/** Remove a context reference through the command host facade. */
export function removeCommandContextReference(
  context: ICommandHostContextReferences,
  path: string,
): IContextReferenceRemoveResult {
  return context.removeContextReference(path);
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
