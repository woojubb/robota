/**
 * The advisor: a second model the main model may consult at decision points it chooses.
 *
 * One controller per top-level session, shared with the in-process subagents that inherit its tool.
 * It owns everything that may change mid-session — the target, on/off, the call limits, consent —
 * so none of it has to touch the tool schema the main model's prompt cache is keyed on.
 */

import {
  calculateModelCost,
  confirmAction,
  createSystemMessage,
  createUserMessage,
  getModelContextWindow,
  isConfirmed,
  readTokenUsageFromMessage,
} from '@robota-sdk/agent-core';

import {
  ADVISOR_MAX_OUTPUT_TOKENS,
  ADVISOR_SYSTEM_PROMPT,
  buildAdvisorRequest,
} from './advisor-request.js';
import { formatAdvisorSpec, parseAdvisorSpec } from './advisor-spec.js';
import { createUsageSummaryEntry } from '../interactive/interactive-session-execution.js';

import type { IAdvisorSetResult, IAdvisorSpec, IAdvisorStatus } from './advisor-spec.js';
import type {
  IAIProvider,
  IHistoryEntry,
  IUserInteraction,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

export const DEFAULT_ADVISOR_CALLS_PER_TURN = 2;
export const DEFAULT_ADVISOR_CALLS_PER_SESSION = 10;

/** A resolved advisor: the provider instance to ask and what it is called. */
export interface IAdvisorTarget {
  readonly provider: IAIProvider;
  readonly model: string;
  /** Compared with the main provider's name to decide whether history leaves for another vendor. */
  readonly vendor: string;
  /** Defaults to the model's known window. */
  readonly contextWindow?: number;
}

/** Host-supplied: build the provider a spec names. Throws when the profile does not exist. */
export type TAdvisorTargetResolver = (spec: IAdvisorSpec) => IAdvisorTarget;

/** Per-vendor consent to send conversation history there, persisted by the host. */
export interface IAdvisorConsentStore {
  has(vendor: string): boolean;
  grant(vendor: string): void;
}

export interface IAdvisorControllerOptions {
  /** The advisor configured when the session starts; absent means no Advisor tool this session. */
  readonly spec?: IAdvisorSpec;
  readonly resolveTarget: TAdvisorTargetResolver;
  readonly consent: IAdvisorConsentStore;
  /** The organization's provider allowlist (profile names). */
  readonly allowedProfiles?: readonly string[];
  /** The kill switch: no tool, and nothing can turn the advisor on. */
  readonly killSwitch?: boolean;
  readonly maxCallsPerTurn?: number;
  readonly maxCallsPerSession?: number;
}

export type TAdvisorOutcome = 'answered' | 'repeated' | 'declined' | 'disabled' | 'limit';

export interface IAdvisorConsultation {
  readonly outcome: TAdvisorOutcome;
  /** What the main model receives as the tool result. */
  readonly text: string;
}

/** One consultation, as the calling session sees it. */
export interface IAdvisorConsultRequest {
  readonly question?: string;
  /** The calling session's conversation, ending in the Advisor call itself. */
  readonly history: readonly TUniversalMessage[];
  readonly systemPrompt: string;
  /** The main provider's name. */
  readonly mainVendor: string;
  readonly sessionId: string;
  readonly ask?: IUserInteraction['ask'];
  readonly signal?: AbortSignal;
  /** Where the advisor's token usage is recorded. */
  readonly recordUsage?: (entry: IHistoryEntry) => void;
}

interface ITurnState {
  turn: number;
  calls: number;
  answers: Map<string, string>;
}

function normalizeQuestion(question: string | undefined): string {
  return (question ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function countUserMessages(history: readonly TUniversalMessage[]): number {
  return history.filter((message) => message.role === 'user').length;
}

const REFUSAL_STOP_REASONS = new Set(['refusal', 'content_filter']);

function answerText(response: TUniversalMessage): string | undefined {
  const stopReason = response.metadata?.['stopReason'] ?? response.metadata?.['finishReason'];
  if (typeof stopReason === 'string' && REFUSAL_STOP_REASONS.has(stopReason)) return undefined;
  if (typeof response.content !== 'string') return undefined;
  const text = response.content.trim();
  return text.length > 0 ? text : undefined;
}

function frameGuidance(model: string, answer: string): string {
  return [
    `Advisor (${model}) guidance. This is a second opinion, not a verified fact: check it against`,
    'your own evidence (the files, tool output and test results you have) before acting on it, and',
    'prefer that evidence where the two disagree.',
    '',
    answer,
  ].join('\n');
}

function declined(model: string, reason: string): IAdvisorConsultation {
  return {
    outcome: 'declined',
    text: `Advisor (${model}) declined (${reason}). Continue on your own judgement.`,
  };
}

export class AdvisorController {
  private spec: IAdvisorSpec | undefined;
  private enabled: boolean;
  private readonly registered: boolean;
  private readonly killSwitch: boolean;
  private readonly maxCallsPerTurn: number;
  private readonly maxCallsPerSession: number;
  private sessionCalls = 0;
  private cachedTarget: { key: string; target: IAdvisorTarget } | undefined;
  private readonly turns = new Map<string, ITurnState>();

  constructor(private readonly options: IAdvisorControllerOptions) {
    this.killSwitch = options.killSwitch === true;
    this.spec = options.spec;
    this.enabled = !this.killSwitch && options.spec !== undefined;
    this.registered = this.enabled && this.isAllowed(options.spec!);
    this.maxCallsPerTurn = options.maxCallsPerTurn ?? DEFAULT_ADVISOR_CALLS_PER_TURN;
    this.maxCallsPerSession = options.maxCallsPerSession ?? DEFAULT_ADVISOR_CALLS_PER_SESSION;
  }

  /** Whether the Advisor tool belongs in this session's tool list. Fixed for the session's life. */
  isRegistered(): boolean {
    return this.registered;
  }

  status(): IAdvisorStatus {
    return {
      ...(this.spec !== undefined ? { target: formatAdvisorSpec(this.spec) } : {}),
      enabled: this.enabled,
      registered: this.registered,
      killSwitch: this.killSwitch,
      sessionCalls: this.sessionCalls,
      maxCallsPerSession: this.maxCallsPerSession,
    };
  }

  /** The name the transcript shows on the Advisor tool line. */
  displayLabel(): string {
    if (!this.enabled || this.spec === undefined) return 'off';
    return this.spec.model ?? this.resolveQuietly()?.model ?? this.spec.profile;
  }

  /** `/advisor <spec>` or `/advisor off`. Changes the target only, never the tool. */
  set(value: string): IAdvisorSetResult {
    let parsed: IAdvisorSpec | 'off' | undefined;
    try {
      parsed = parseAdvisorSpec(value);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (parsed === undefined) return { success: false, message: 'Name an advisor, or "off".' };
    if (parsed === 'off') {
      this.enabled = false;
      return { success: true, message: 'Advisor off.', saved: 'off' };
    }
    if (this.killSwitch) {
      return { success: false, message: 'The advisor is disabled by the environment kill switch.' };
    }
    if (!this.isAllowed(parsed)) {
      return {
        success: false,
        message: `Provider "${parsed.profile}" is not allowed by your organization policy.`,
      };
    }
    try {
      this.targetFor(parsed);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
    this.spec = parsed;
    this.enabled = true;
    const saved = formatAdvisorSpec(parsed);
    return {
      success: true,
      message: this.registered
        ? `Advisor: ${saved}.`
        : `Advisor saved as ${saved}. It is available from the next session: the Advisor tool is added only when a session starts with one.`,
      saved,
    };
  }

  async consult(request: IAdvisorConsultRequest): Promise<IAdvisorConsultation> {
    const spec = this.spec;
    if (this.killSwitch || !this.enabled || spec === undefined) {
      return {
        outcome: 'disabled',
        text: 'Advisor is disabled for this session. Continue on your own judgement.',
      };
    }
    const label = spec.model ?? spec.profile;
    if (!this.isAllowed(spec)) return declined(label, 'not allowed by organization policy');

    const turn = this.turnState(request.sessionId, countUserMessages(request.history));
    const questionKey = normalizeQuestion(request.question);
    const earlier = turn.answers.get(questionKey);
    if (earlier !== undefined) return { outcome: 'repeated', text: earlier };
    if (turn.calls >= this.maxCallsPerTurn) {
      return {
        outcome: 'limit',
        text: `Advisor limit reached (${this.maxCallsPerTurn} calls per turn). Continue on your own judgement.`,
      };
    }
    if (this.sessionCalls >= this.maxCallsPerSession) {
      return {
        outcome: 'limit',
        text: `Advisor limit reached (${this.maxCallsPerSession} calls per session). Continue on your own judgement.`,
      };
    }

    let target: IAdvisorTarget;
    try {
      target = this.targetFor(spec);
    } catch (error) {
      return declined(label, error instanceof Error ? error.message : String(error));
    }
    if (!(await this.hasConsent(target, request))) {
      return declined(
        target.model,
        `sending the conversation to ${target.vendor} needs the user's consent`,
      );
    }
    const built = buildAdvisorRequest({
      systemPrompt: request.systemPrompt,
      history: request.history,
      ...(request.question !== undefined ? { question: request.question } : {}),
      contextWindow: target.contextWindow ?? getModelContextWindow(target.model),
    });
    if (built === undefined) return declined(target.model, 'context too large');

    turn.calls += 1;
    this.sessionCalls += 1;
    request.signal?.throwIfAborted();
    const response = await target.provider.chat(
      [createSystemMessage(ADVISOR_SYSTEM_PROMPT), createUserMessage(built.prompt)],
      {
        model: target.model,
        toolChoice: 'none',
        maxTokens: ADVISOR_MAX_OUTPUT_TOKENS,
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
      },
    );
    this.recordUsage(target.model, response, request.recordUsage);
    const answer = answerText(response);
    const result =
      answer === undefined
        ? declined(target.model, 'no answer')
        : { outcome: 'answered' as const, text: frameGuidance(target.model, answer) };
    turn.answers.set(questionKey, result.text);
    return result;
  }

  private isAllowed(spec: IAdvisorSpec): boolean {
    const allowed = this.options.allowedProfiles;
    return allowed === undefined || allowed.includes(spec.profile);
  }

  private targetFor(spec: IAdvisorSpec): IAdvisorTarget {
    const key = formatAdvisorSpec(spec);
    if (this.cachedTarget?.key === key) return this.cachedTarget.target;
    const target = this.options.resolveTarget(spec);
    this.cachedTarget = { key, target };
    return target;
  }

  private resolveQuietly(): IAdvisorTarget | undefined {
    if (this.spec === undefined) return undefined;
    try {
      return this.targetFor(this.spec);
    } catch {
      // allow-fallback: a label only; the call itself reports why the target cannot be built
      return undefined;
    }
  }

  private async hasConsent(
    target: IAdvisorTarget,
    request: IAdvisorConsultRequest,
  ): Promise<boolean> {
    if (target.vendor === request.mainVendor || this.options.consent.has(target.vendor))
      return true;
    if (request.ask === undefined) return false;
    const response = await request.ask(
      confirmAction(
        'advisor-consent',
        `Send this conversation to ${target.vendor} (${target.model}) for advice?`,
        {
          description: `The main model runs on ${request.mainVendor}. Consulting the advisor sends the whole conversation, tool output included, to ${target.vendor}. You are asked once per vendor.`,
        },
      ),
    );
    if (!isConfirmed(response)) return false;
    this.options.consent.grant(target.vendor);
    return true;
  }

  private turnState(sessionId: string, turn: number): ITurnState {
    const existing = this.turns.get(sessionId);
    if (existing !== undefined && existing.turn === turn) return existing;
    const fresh: ITurnState = { turn, calls: 0, answers: new Map() };
    this.turns.set(sessionId, fresh);
    return fresh;
  }

  private recordUsage(
    model: string,
    response: TUniversalMessage,
    record: IAdvisorConsultRequest['recordUsage'],
  ): void {
    const usage = readTokenUsageFromMessage(response);
    if (record === undefined || usage === undefined) return;
    const costUsd = calculateModelCost(model, usage.inputTokens, usage.outputTokens);
    record(
      createUsageSummaryEntry({
        kind: 'exact',
        scope: 'turn',
        totalTokens: usage.inputTokens + usage.outputTokens,
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        contextUsedTokens: 0,
        contextMaxTokens: 0,
        contextUsedPercentage: 0,
        ...(costUsd !== undefined
          ? { costStatus: 'estimated' as const, costUsd }
          : { costStatus: 'unknown' as const }),
        source: { scope: 'tool', id: `advisor:${model}`, label: `Advisor (${model})` },
      }),
    );
  }
}
