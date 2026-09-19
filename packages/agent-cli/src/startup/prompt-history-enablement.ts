/**
 * SCREEN-1993 — prompt-history enablement and project key (agent-cli owned).
 *
 * The TUI's Ctrl+R search reads `~/.robota/history.jsonl`, a derived projection of the prompts the
 * owner typed, written by the interactive session on every owner turn. Two product decisions live
 * here, stated: it is ON by default (prompts are already persisted verbatim per session, the file is
 * owner-only, and the shell-history analog is default-on — the README says what is written, where,
 * and how to turn it off), and only the interactive TUI writes it (`--serve` and print mode receive
 * no writer: prompt intake is TUI state).
 *
 * Precedence: settings.json `promptHistory: false` turns it off; `ROBOTA_PROMPT_HISTORY=1|0` wins
 * over settings. The literal is read here, in the shell, never in a library package.
 */
import { realpathSync } from 'node:fs';

import {
  createUserPromptHistoryFile,
  getWorkspaceProjectIdentity,
} from '@robota-sdk/agent-framework';

import type {
  IPromptHistoryOptions,
  TSettingsData,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IPromptHistorySource } from '@robota-sdk/agent-interface-session';

const PROMPT_HISTORY_ENV = 'ROBOTA_PROMPT_HISTORY';

/** `promptHistory` from the raw settings record; `undefined` when absent or not a boolean. */
export function readPromptHistorySetting(settings: TSettingsData | undefined): boolean | undefined {
  const raw = settings?.['promptHistory'];
  return typeof raw === 'boolean' ? raw : undefined;
}

export function resolvePromptHistoryEnablement(inputs: {
  readonly settings: boolean | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}): boolean {
  let enabled = inputs.settings ?? true;
  const override = inputs.env[PROMPT_HISTORY_ENV]?.trim();
  if (override === '1') enabled = true;
  else if (override === '0') enabled = false;
  return enabled;
}

/**
 * The project key every entry of this run carries: the workspace identity's worktree root whenever
 * an identity resolved (trusted, untrusted or revoked alike — the resolver is trust-independent);
 * only `identity-unavailable` / `store-unavailable` without an identity fall back to the real path of
 * the cwd. The trust service already resolved the identity at startup, so nothing is resolved twice.
 */
export function resolvePromptHistoryProject(access: TWorkspaceProjectAccess, cwd: string): string {
  if (access.status === 'trusted')
    return getWorkspaceProjectIdentity(access.authority).worktreeRoot;
  if (access.identity !== undefined) return access.identity.worktreeRoot;
  return realpathSync(cwd);
}

/** What the interactive TUI receives: the session-side writer and the overlay's source, or nothing. */
export interface IPromptHistorySurface {
  readonly promptHistory?: IPromptHistoryOptions;
  readonly promptHistorySource?: IPromptHistorySource;
  readonly promptHistoryProject?: string;
}

export function createPromptHistorySurface(inputs: {
  readonly enabled: boolean;
  readonly project: string;
}): IPromptHistorySurface {
  if (!inputs.enabled) return {};
  const file = createUserPromptHistoryFile();
  return {
    promptHistory: { writer: file, project: inputs.project },
    promptHistorySource: file,
    promptHistoryProject: inputs.project,
  };
}

/** The one call `cli.ts` makes on the TUI path: settings + env → enablement, access → project key. */
export function resolvePromptHistoryRenderFields(inputs: {
  readonly settings: TSettingsData | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly access: TWorkspaceProjectAccess;
  readonly cwd: string;
}): IPromptHistorySurface {
  const enabled = resolvePromptHistoryEnablement({
    settings: readPromptHistorySetting(inputs.settings),
    env: inputs.env,
  });
  if (!enabled) return {};
  return createPromptHistorySurface({
    enabled,
    project: resolvePromptHistoryProject(inputs.access, inputs.cwd),
  });
}
