/**
 * ARCH-029: the `ICommandSessionRuntime` role ports.
 *
 * Split out of `host-context.ts` because the decomposition made that file 448 lines — over the
 * anti-monolith limit. The split follows the same seam the ports do: one file per contract axis,
 * so a reader looking for a session capability is not reading the agent-job ones.
 */

import type { TAutoCompactThreshold } from './context/context-command-api.js';
import type { IModelReapplyOptions } from './host-context.js';
import type {
  IContextWindowState,
  IHistoryEntry,
  TPermissionMode,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

/** Reading and clearing the conversation the session holds. */
export interface ICommandSessionHistory {
  clearHistory(): void;
  getMessageCount(): number;
  getFullHistory(): IHistoryEntry[];
  getHistory(): TUniversalMessage[];
}

/** The session's context window and its compaction policy. */
export interface ICommandSessionContextWindow {
  compact(instructions?: string): Promise<void>;
  getContextState(): IContextWindowState;
  getAutoCompactThreshold(): number | false;
  setAutoCompactThreshold(threshold: TAutoCompactThreshold): void;
}

/** What the session is currently permitted to do. */
export interface ICommandSessionPermissions {
  getPermissionMode(): TPermissionMode;
  setPermissionMode(mode: TPermissionMode): void;
  getSessionAllowedTools(): readonly string[];
  /**
   * ARCH-040 Group C (issue #1934): re-apply a preset's tool lists to the LIVE enforcer.
   *
   * REQUIRED, not optional. An optional member would let every consumer invent its own answer for an
   * absent one, and the answer here governs permissions — a runtime that quietly did nothing would
   * be the startup/live divergence this seam exists to close, wearing a different hat.
   *
   * Without it the startup path could apply a preset's tool lists and `/preset` could not: one
   * session holding two answers for the same preset depending on WHEN it was chosen.
   */
  applyPresetToolLists(preset: {
    allowedTools?: readonly string[];
    deniedTools?: readonly string[];
  }): void;
}

/** Who this session is, and what it has spent. */
export interface ICommandSessionIdentity {
  getSessionId(): string;
  getSessionTokenUsage(): { inputTokens: number; outputTokens: number } | undefined;
  getModelId(): string | undefined;
}

/** Live model reconfiguration. */
export interface ICommandSessionModel {
  /**
   * Re-apply model/effort/temperature/maxOutputTokens to the live session (PRESET-013).
   * May be async: the runtime ensures the agent is fully initialized before mutating its model
   * configuration, so callers must await the result.
   */
  applyModelOptions(options: IModelReapplyOptions): void | Promise<void>;
  /**
   * ARCH-040 — re-apply the preset's `agentName` to the live agent.
   *
   * REQUIRED, like every other member of this role port: an optional one would make each consumer
   * decide what "no rename seam" means, and `/preset` would decide it alone.
   */
  applyAgentName(name: string): void | Promise<void>;
}

/** Live preset state carried by the session. */
export interface ICommandSessionPreset {
  /** Read the active preset id (PRESET-011 runtime state). */
  getActivePresetId(): string;
  /** Set the active preset id (PRESET-011 runtime state — pure state, no option re-application). */
  setActivePresetId(id: string): void;
  /** Toggle subagent dispatch live for the running session (PRESET-016 runtime gate). */
  setParallelSubagentsEnabled(enabled: boolean): void;
}

/** Aggregate: all 18 members remain source-compatible. Declare a role port instead of this. */
export interface ICommandSessionRuntime
  extends
    ICommandSessionHistory,
    ICommandSessionContextWindow,
    ICommandSessionPermissions,
    ICommandSessionIdentity,
    ICommandSessionModel,
    ICommandSessionPreset {}
