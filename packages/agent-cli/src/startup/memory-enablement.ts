/**
 * SELFHOST-008 P6 — memory enablement resolver (agent-cli owned).
 *
 * Resolves ONE user-facing `memory` switch (default OFF, opt-in) and, when ON, builds the
 * memory-related session option fields the three agent-cli surfaces (print / serve / TUI) inject into
 * `TInteractiveSessionOptions`. The enablement DECISION, policy default, and budget are surface-owned
 * here — the neutral `agent-framework` memory library is untouched (HARNESS-029 neutrality).
 *
 * Precedence (lowest → highest): `settings.json` `memory.enabled` (SSOT) ← `--memory`/`--no-memory`
 * CLI flag ← `ROBOTA_MEMORY=1|0` env (env wins). Default OFF ⇒ NO memory options injected (today's
 * behavior exactly).
 */

import { join } from 'node:path';

import { createFileSystemMemoryStore } from '@robota-sdk/agent-framework';

import type {
  IMemoryBudget,
  IMemoryStore,
  IAutomaticMemoryConfig,
  IPerTurnRecallConfig,
} from '@robota-sdk/agent-framework';

/**
 * Agent-cli-owned `memory` settings entry (settings.json). One user-facing switch (`enabled`) plus a
 * `autoSave` sub-setting that flips the capture policy from the safe default (`approval_required`
 * queue) to `auto_save`. The neutral library defines no enablement config — it lives here.
 */
export interface IMemorySettings {
  /** SSOT enablement switch. Absent ⇒ OFF. */
  enabled?: boolean;
  /** Flip the automatic-capture policy from `approval_required` (queue) to `auto_save`. */
  autoSave?: boolean;
}

/** The resolved enablement decision after applying settings ← flag ← env precedence. */
export interface IResolvedMemoryEnablement {
  enabled: boolean;
  autoSave: boolean;
}

/**
 * The memory-related session option fields. Empty (`{}`) when disabled — spreading it into the resolved
 * `TInteractiveSessionOptions` then injects nothing, preserving today's behavior. Field types are the
 * neutral library's own (`IMemoryStore` / `IAutomaticMemoryConfig` / `IPerTurnRecallConfig`).
 */
export interface IMemorySessionOptions {
  memoryStore?: IMemoryStore;
  automaticMemory?: IAutomaticMemoryConfig;
  recallMemory?: IPerTurnRecallConfig;
}

/** Inputs to the pure enablement resolver. */
export interface IMemoryEnablementInputs {
  /** Parsed `memory` entry from settings.json (SSOT). Absent ⇒ default OFF. */
  settings?: IMemorySettings | undefined;
  /** `--memory` (true) / `--no-memory` (false); `undefined` when neither flag is given. */
  flagEnabled?: boolean | undefined;
  /** `--memory-autosave` flag. */
  flagAutoSave?: boolean | undefined;
  /** Raw `ROBOTA_MEMORY` env value (`'1'` enables, `'0'` disables; anything else ignored). */
  env?: string | undefined;
}

/** A sensible default recall/retrieval budget: at most 5 topics, each truncated to 2000 chars. */
export const DEFAULT_MEMORY_BUDGET: IMemoryBudget = { maxTopics: 5, maxTopicChars: 2000 };

/**
 * Extract the `memory` entry from a raw settings record (the untyped `readSettings` result). Returns
 * `undefined` when absent or malformed — the resolver then treats it as default OFF. Only recognizes the
 * `enabled` / `autoSave` booleans; unknown keys are ignored (never a throw).
 */
export function readMemorySettings(
  settings: Record<string, unknown> | undefined,
): IMemorySettings | undefined {
  const raw = settings?.['memory'];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const parsed: IMemorySettings = {};
  if (typeof record['enabled'] === 'boolean') parsed.enabled = record['enabled'];
  if (typeof record['autoSave'] === 'boolean') parsed.autoSave = record['autoSave'];
  return parsed;
}

/**
 * Pure enablement resolver: `settings.json` `memory.enabled` (SSOT) ← `--memory`/`--no-memory` ←
 * `ROBOTA_MEMORY=1|0` (env wins). Default OFF. `autoSave` = settings.autoSave OR `--memory-autosave`.
 */
export function resolveMemoryEnablement(
  inputs: IMemoryEnablementInputs,
): IResolvedMemoryEnablement {
  // SSOT: settings.json memory.enabled (absent ⇒ OFF).
  let enabled = inputs.settings?.enabled ?? false;
  // Override: --memory / --no-memory (when either flag is present).
  if (inputs.flagEnabled !== undefined) enabled = inputs.flagEnabled;
  // Override (wins): ROBOTA_MEMORY=1|0 env escape hatch.
  const env = inputs.env?.trim();
  if (env === '1') enabled = true;
  else if (env === '0') enabled = false;

  const autoSave = (inputs.settings?.autoSave ?? false) || inputs.flagAutoSave === true;
  return { enabled, autoSave };
}

/**
 * Build the memory session option fields from the resolved decision. Disabled ⇒ `{}` (inject nothing).
 * Enabled ⇒ the fs reference store + per-turn recall + automatic capture (policy `approval_required` by
 * default, `auto_save` when the user opted in). Capture + recall are enabled together (one switch).
 */
export function buildMemorySessionOptions(
  resolved: IResolvedMemoryEnablement,
  cwd: string,
): IMemorySessionOptions {
  if (!resolved.enabled) return {};
  const budget = DEFAULT_MEMORY_BUDGET;
  return {
    memoryStore: createFileSystemMemoryStore(cwd),
    recallMemory: { budget },
    automaticMemory: {
      policy: resolved.autoSave ? 'auto_save' : 'approval_required',
      retrieval: budget,
    },
  };
}

let enableNoticePrinted = false;

/**
 * Print a concise, one-time (per process) enable notice to stderr: what is captured, where it is stored,
 * and how to disable. Best-effort — never throws, and a no-op after the first call.
 */
export function printMemoryEnableNoticeOnce(
  cwd: string,
  write: (message: string) => void = (message) => {
    process.stderr.write(message);
  },
): void {
  if (enableNoticePrinted) return;
  enableNoticePrinted = true;
  const storePath = join(cwd, '.robota', 'memory');
  write(
    `Memory is ON (opt-in): capturing and recalling durable memory in ${storePath}. ` +
      `Inspect with /memory; disable with --no-memory or "memory": { "enabled": false } in settings.json.\n`,
  );
}

/** Test-only: reset the process-level one-time-notice latch. */
export function resetMemoryEnableNoticeForTests(): void {
  enableNoticePrinted = false;
}
