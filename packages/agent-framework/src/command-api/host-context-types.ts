/**
 * Leaf type module for the small, self-contained types that used to be declared directly in
 * `host-context.ts` alongside its `host-roles.ts`/`session-roles.ts`/`agent-job-roles.ts`
 * re-exports.
 *
 * `host-context.ts` is otherwise a pure re-export barrel over those three role-port files, and
 * several of them (`host-roles.ts`, `session-roles.ts`) imported these locally-declared types back
 * from `host-context.ts` — which, combined with the barrel's re-export edge, created import
 * cycles. This file has no internal `command-api` imports, so anything importing from it cannot
 * cycle back.
 */
import type { TModelEffortSelection } from '@robota-sdk/agent-core';
import type {
  ICommandListEntry,
  TCommandInvocationSource,
} from '@robota-sdk/agent-interface-command';
import type { ISessionReplayValidationResult } from '@robota-sdk/agent-session';

// ICommandListEntry SSOT relocated to @robota-sdk/agent-interface-command (DATA-001).
// TCommandInvocationSource SSOT relocated to @robota-sdk/agent-interface-command (REMOTE-003).
export type { ICommandListEntry, TCommandInvocationSource };

export interface ICommandSkillListEntry {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly argumentHint?: string;
  readonly context?: string;
  readonly agent?: string;
}

export interface ICommandSkillActivationRequest {
  readonly invocationSource: TCommandInvocationSource;
  readonly displayInput?: string;
  readonly rawInput?: string;
}

export type TAutoCompactThresholdSource = 'default' | 'settings' | 'session';

/**
 * Live model re-application options (PRESET-013). Carries the model group a preset switch may
 * re-apply to a running session; `maxOutputTokens` maps to the agent's `maxTokens` channel.
 */
export interface IModelReapplyOptions {
  model?: string;
  effort?: TModelEffortSelection;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * A preset `enabledCommandModules`/`disabledCommandModules` name that matched no built command
 * module (INFRA-032). Surfaced as a non-fatal notice on both the startup `--preset` path and the
 * in-session `/preset` path instead of being silently dropped. `kind` records which list the
 * unmatched name came from.
 */
export interface IUnknownCommandModuleName {
  readonly name: string;
  readonly kind: 'enabled' | 'disabled';
}

export interface ICommandSessionReplayValidationReport {
  logFile: string;
  entryCount: number;
  validation: ISessionReplayValidationResult;
}

/**
 * The role a command declares when it reads NOTHING from the host.
 *
 * Deliberately empty, and deliberately named. A command that needs no capability must still accept
 * the dispatch parameter positionally when a later parameter is used, and naming the 46-member
 * aggregate in order to ignore it is precisely the defect this decomposition removes — it takes the
 * whole surface for nothing. Every role port is a supertype of the aggregate; this is the widest
 * such supertype, so any host satisfies it.
 *
 * `unknown` would also type-check here and is NOT used: `code-quality.md` allows it only at trust
 * and `catch` boundaries, and an unused command parameter is neither.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the emptiness IS the contract: this role demands nothing.
export interface ICommandHostNoCapability {}
