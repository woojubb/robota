/**
 * The advisor: a second model the main model may consult at decision points it chooses.
 *
 * One controller per top-level session, shared with the in-process subagents that inherit its tool.
 * It owns everything that may change mid-session — the target, on/off, the call limits, consent —
 * so none of it has to touch the tool schema the main model's prompt cache is keyed on.
 *
 * A round runs its tool calls in parallel, so every check that limits calls is settled before the
 * first `await`: a call takes its slot (and its question's place) synchronously, and gives the slot
 * back if it never reached the advisor.
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

/** A resolved advisor: the provider instance to ask and where it sends what it is given. */
export interface IAdvisorTarget {
  readonly provider: IAIProvider;
  readonly model: string;
  /**
   * Where the conversation goes: the provider type together with the endpoint it talks to. Consent
   * is keyed on it, and it decides whether history leaves for somewhere the main model does not
   * already send it — two endpoints of one provider type are two destinations.
   */
  readonly destination: string;
  /** Defaults to the model's known window. */
  readonly contextWindow?: number;
}

/** Host-supplied: build the provider a spec names. Throws when the profile does not exist. */
export type TAdvisorTargetResolver = (spec: IAdvisorSpec) => IAdvisorTarget;

/** Per-destination consent to send conversation history there, persisted by the host. */
export interface IAdvisorConsentStore {
  has(destination: string): boolean;
  grant(destination: string): void;
}

export interface IAdvisorControllerOptions {
  /** The advisor configured when the session starts; absent means no Advisor tool this session. */
  readonly spec?: IAdvisorSpec;
  readonly resolveTarget: TAdvisorTargetResolver;
  readonly consent: IAdvisorConsentStore;
  /**
   * The destination of the session's main provider, named by its provider id. `undefined` means the
   * host cannot tell, and then every advisor destination counts as a different one.
   */
  readonly mainDestination?: (mainProviderId: string) => string | undefined;
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
  /** The main provider's id (`IAIProvider.name`). */
  readonly mainProviderId: string;
  readonly sessionId: string;
  /** Identifies the turn the call belongs to; the per-turn limit and answer reuse are per turn. */
  readonly turnId: string;
  readonly ask?: IUserInteraction['ask'];
  readonly signal?: AbortSignal;
  /** Where the advisor's token usage is recorded. */
  readonly recordUsage?: (entry: IHistoryEntry) => void;
}

interface ITurnState {
  turnId: string;
  calls: number;
  answers: Map<string, Promise<IAdvisorConsultation>>;
}

/** A consultation's result, and whether it reached the advisor (and so used its slot). */
interface IAttempt {
  readonly consultation: IAdvisorConsultation;
  readonly reachedAdvisor: boolean;
}

function normalizeQuestion(question: string | undefined): string {
  return (question ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const REFUSAL_STOP_REASONS = new Set(['refusal', 'content_filter']);

function answerText(response: TUniversalMessage): string | undefined {
  const stopReason = response.metadata?.['stopReason'] ?? response.metadata?.['finishReason'];
  if (typeof stopReason === 'string' && REFUSAL_STOP_REASONS.has(stopReason)) return undefined;
  if (typeof response.content !== 'string') return undefined;
  const text = response.content.trim();
  return text.length > 0 ? text : undefined;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' ? value : undefined;
}

/**
 * Name the class of a provider failure, never its text: an error message can quote the request,
 * and the request is the conversation.
 */
export function classifyAdvisorFailure(error: unknown): string {
  const status = statusOf(error);
  const text = (
    error instanceof Error ? `${error.name} ${error.message}` : String(error)
  ).toLowerCase();
  if (
    status === 413 ||
    /context (length|window)|too long|too many tokens|maximum (context|number of tokens)|token limit|input is too large/.test(
      text,
    )
  ) {
    return 'context too large';
  }
  if (status === 401 || status === 403 || /unauthori|forbidden|api key|authentication/.test(text)) {
    return 'authentication failed';
  }
  if (status === 429 || /rate.?limit|quota/.test(text)) return 'rate limited';
  if (/timed? ?out/.test(text)) return 'timed out';
  if (/network|econn|fetch failed|socket|enotfound/.test(text)) return 'network error';
  return 'request failed';
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
  private readonly pendingConsent = new Map<string, Promise<boolean>>();

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
    // Everything up to the reservation below runs without yielding, so parallel calls in one round
    // see each other's slots and questions.
    const spec = this.spec;
    if (this.killSwitch || !this.enabled || spec === undefined) {
      return {
        outcome: 'disabled',
        text: 'Advisor is disabled for this session. Continue on your own judgement.',
      };
    }
    const label = spec.model ?? spec.profile;
    if (!this.isAllowed(spec)) return declined(label, 'not allowed by organization policy');

    const turn = this.turnState(request.sessionId, request.turnId);
    const questionKey = normalizeQuestion(request.question);
    const earlier = turn.answers.get(questionKey);
    if (earlier !== undefined) return { outcome: 'repeated', text: (await earlier).text };
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
    turn.calls += 1;
    this.sessionCalls += 1;
    const attempt = this.attempt(spec, request);
    const answer = attempt.then((result) => result.consultation);
    turn.answers.set(questionKey, answer);

    const release = (): void => {
      turn.calls -= 1;
      this.sessionCalls -= 1;
      if (turn.answers.get(questionKey) === answer) turn.answers.delete(questionKey);
    };
    let result: IAttempt;
    try {
      result = await attempt;
    } catch (error) {
      release();
      throw error;
    }
    if (!result.reachedAdvisor) release();
    return result.consultation;
  }

  private async attempt(spec: IAdvisorSpec, request: IAdvisorConsultRequest): Promise<IAttempt> {
    const unused = (consultation: IAdvisorConsultation): IAttempt => ({
      consultation,
      reachedAdvisor: false,
    });
    let target: IAdvisorTarget;
    try {
      target = this.targetFor(spec);
    } catch (error) {
      return unused(
        declined(
          spec.model ?? spec.profile,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    if (!(await this.hasConsent(target, request))) {
      return unused(
        declined(
          target.model,
          `sending the conversation to ${target.destination} needs the user's consent`,
        ),
      );
    }
    const built = buildAdvisorRequest({
      systemPrompt: request.systemPrompt,
      history: request.history,
      ...(request.question !== undefined ? { question: request.question } : {}),
      contextWindow: target.contextWindow ?? getModelContextWindow(target.model),
    });
    if (built === undefined) return unused(declined(target.model, 'context too large'));

    request.signal?.throwIfAborted();
    let response: TUniversalMessage;
    try {
      response = await target.provider.chat(
        [createSystemMessage(ADVISOR_SYSTEM_PROMPT), createUserMessage(built.prompt)],
        {
          model: target.model,
          toolChoice: 'none',
          maxTokens: ADVISOR_MAX_OUTPUT_TOKENS,
          ...(request.signal !== undefined ? { signal: request.signal } : {}),
        },
      );
    } catch (error) {
      if (isAbort(error, request.signal)) throw error;
      return unused(declined(target.model, classifyAdvisorFailure(error)));
    }
    this.recordUsage(target.model, response, request.recordUsage);
    const answer = answerText(response);
    return {
      consultation:
        answer === undefined
          ? declined(target.model, 'no answer')
          : { outcome: 'answered', text: frameGuidance(target.model, answer) },
      reachedAdvisor: true,
    };
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

  private hasConsent(target: IAdvisorTarget, request: IAdvisorConsultRequest): Promise<boolean> {
    const destination = target.destination;
    if (this.options.mainDestination?.(request.mainProviderId) === destination) {
      return Promise.resolve(true);
    }
    if (this.options.consent.has(destination)) return Promise.resolve(true);
    const ask = request.ask;
    if (ask === undefined) return Promise.resolve(false);
    // One question per destination, however many calls are waiting on the answer.
    const pending = this.pendingConsent.get(destination);
    if (pending !== undefined) return pending;
    const asking = (async (): Promise<boolean> => {
      const response = await ask(
        confirmAction(
          'advisor-consent',
          `Send this conversation to ${destination} (${target.model}) for advice?`,
          {
            description: `Consulting the advisor sends the whole conversation, tool output included, to ${destination}, which is not where the main model runs. You are asked once per destination.`,
          },
        ),
      );
      if (!isConfirmed(response)) return false;
      this.options.consent.grant(destination);
      return true;
    })().finally(() => this.pendingConsent.delete(destination));
    this.pendingConsent.set(destination, asking);
    return asking;
  }

  private turnState(sessionId: string, turnId: string): ITurnState {
    const existing = this.turns.get(sessionId);
    if (existing !== undefined && existing.turnId === turnId) return existing;
    const fresh: ITurnState = { turnId, calls: 0, answers: new Map() };
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
