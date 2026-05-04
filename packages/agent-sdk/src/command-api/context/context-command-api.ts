import type { IContextWindowState } from '@robota-sdk/agent-core';
import { AUTO_COMPACT_THRESHOLD } from '@robota-sdk/agent-sessions';
import type { ICommandSettingsAdapter, ICommandSettingsDocument } from '../host-adapters.js';
import type { ICommandHostContext } from '../host-context.js';
import type { TAutoCompactThresholdSource } from '../host-context.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../../context/context-reference-inventory.js';
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
}

/** Read context-window state through the command host facade. */
export function readCommandContextState(context: ICommandHostContext): IContextWindowState {
  return context.getContextState();
}

/** Read the effective automatic compact policy through the command host facade. */
export function readAutoCompactThreshold(context: ICommandHostContext): TAutoCompactThreshold {
  return context.getAutoCompactThreshold();
}

/** Read the source of the effective automatic compact policy. */
export function readAutoCompactThresholdSource(
  context: ICommandHostContext,
): TAutoCompactThresholdSource {
  return context.getAutoCompactThresholdSource?.() ?? 'session';
}

/** Update the active session's automatic compact policy through the command host facade. */
export function setCommandAutoCompactThreshold(
  context: ICommandHostContext,
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
  context: ICommandHostContext,
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
export function resetAutoCompactThresholdSetting(context: ICommandHostContext): boolean {
  const settings = getSettingsAdapter(context);
  if (!settings) return false;

  const next: ICommandSettingsDocument = { ...settings.read() };
  delete next[AUTO_COMPACT_THRESHOLD_SETTINGS_KEY];
  settings.write(next);
  return true;
}

/** Run manual compaction through the command host facade and return before/after state. */
export async function compactCommandContext(
  context: ICommandHostContext,
  instructions?: string,
): Promise<ICompactContextResult> {
  const before = readCommandContextState(context);
  await context.compactContext(instructions);
  const after = readCommandContextState(context);
  return { before, after };
}

/** List context reference inventory entries through the command host facade. */
export function listCommandContextReferences(
  context: ICommandHostContext,
): IContextReferenceItem[] {
  return context.listContextReferences?.() ?? [];
}

/** Add a manual context reference through the command host facade. */
export async function addCommandContextReference(
  context: ICommandHostContext,
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
  context: ICommandHostContext,
  path: string,
): IContextReferenceRemoveResult {
  return context.removeContextReference?.(path) ?? {};
}

/** Clear all context references through the command host facade. */
export function clearCommandContextReferences(
  context: ICommandHostContext,
): IContextReferenceClearResult {
  return context.clearContextReferences?.() ?? { removed: [] };
}

function getSettingsAdapter(
  context: ICommandHostContext,
): ICommandSettingsAdapter<ICommandSettingsDocument> | undefined {
  return context.getCommandHostAdapters?.().settings;
}
