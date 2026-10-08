import {
  PROVIDER_CALL_EVENTS,
  PROVIDER_FALLBACK_EVENTS,
  readModelFallbackNotice,
  createLogger,
  isModelEffort,
  runHooks,
  traceEnvFor,
} from '@robota-sdk/agent-core';
import type { IRunOptions, THooksConfig, ISubprocessTraceEnv } from '@robota-sdk/agent-core';
import {
  createToolExecutionBridge,
  forwardToolExecutionEvent,
} from './session-tool-execution-bridge.js';
import type { TSessionLogData } from './session-logger.js';
import type { IRunContext } from './session-run-context.js';
const logger = createLogger('SessionRunObservation');

/**
 * SELFHOST-009: fire an INFORMATIONAL-ONLY model-call hook event mapped from a provider-call
 * execution event the turn owner already observes. Fire-and-forget — `onExecutionEvent` is a void,
 * un-awaited callback, so this `runHooks` call cannot block or mutate `provider.chat()`. Its result
 * is never consulted for gating; only PreToolUse gates.
 */
function fireModelCallHook(
  ctx: IRunContext,
  hookEvent: 'PreModelCall' | 'PostModelCall',
  data: Record<string, unknown>,
  hookTraceEnv: ISubprocessTraceEnv | undefined,
): void {
  const model = typeof data['model'] === 'string' ? (data['model'] as string) : ctx.model;
  const provider =
    typeof data['provider'] === 'string' ? (data['provider'] as string) : ctx.aiProvider.name;
  const rawEffort = data['effort'];
  const effort =
    typeof rawEffort === 'string' && isModelEffort(rawEffort)
      ? rawEffort
      : (ctx.effort ??
        (typeof ctx.agent.getModel === 'function' ? ctx.agent.getModel().effort : undefined) ??
        'high');
  const round = typeof data['round'] === 'number' ? (data['round'] as number) : undefined;
  void runHooks(
    ctx.hooks as THooksConfig | undefined,
    hookEvent,
    {
      session_id: ctx.sessionId,
      cwd: ctx.cwd,
      hook_event_name: hookEvent,
      model,
      provider,
      effort,
      ...(round !== undefined && { round }),
      ...(ctx.permissionMode !== undefined && { permission_mode: ctx.permissionMode }),
      ...(ctx.transcriptPath !== undefined && { transcript_path: ctx.transcriptPath }),
      env: {
        CLAUDE_PROJECT_DIR: ctx.cwd,
        CLAUDE_SESSION_ID: ctx.sessionId,
      },
    },
    ctx.hookTypeExecutors,
    hookTraceEnv,
  ).catch((error) => logger.warn('hook failed', { error }));
}

/** Observation callbacks for genuinely new execution boundaries in a run or continuation. */
export function createRunObservers(
  ctx: IRunContext,
  traceContext?: IRunOptions['traceContext'],
): Pick<IRunOptions, 'onTextDelta' | 'onExecutionEvent'> {
  const hookTraceEnv = traceContext
    ? traceEnvFor('hooks', traceContext, traceContext.parentSpanId)
    : undefined;
  const toolExecutionBridge = createToolExecutionBridge({
    knownToolNames: ctx.knownToolNames ?? [],
    ...(ctx.onToolExecution && { onToolExecution: ctx.onToolExecution }),
  });
  const onTextDelta = ctx.onTextDelta
    ? (delta: string): void => {
        ctx.log('text_delta', { delta });
        ctx.onTextDelta?.(delta);
      }
    : undefined;

  let calledModel: Record<string, unknown> = {};
  return {
    onExecutionEvent: (event, data) => {
      // Core has already appended this exact message, and tool dispatch has not started yet.
      // Refuse to proceed if its intent cannot be saved; a later snapshot cannot recover an
      // external effect whose call was never durably recorded.
      if (event === 'history_mutation' && data['mutation'] === 'append_message') {
        const message = data['message'] as Record<string, unknown> | undefined;
        if (message?.['role'] === 'user' ||
            (message?.['role'] === 'assistant' && Array.isArray(message['toolCalls']) && message['toolCalls'].length > 0)) {
          ctx.checkpointHistory?.();
        }
      }
      // This new local observability signal is persisted by the interactive history owner;
      // it is not a replay-substrate session-log event.
      if (event !== PROVIDER_CALL_EVENTS.COMPLETED) ctx.log(event, data as TSessionLogData);
      forwardToolExecutionEvent(toolExecutionBridge, event, data);
      // SELFHOST-009: fire the informational-only model-call events from the provider-call
      // execution events the turn owner already observes. provider_request → PreModelCall (before
      // provider.chat() returns); provider_response_normalized → PostModelCall (the SINGLE
      // canonical source — NOT provider_response_raw, which would double-fire per round). Both are
      // fire-and-forget: this callback is void/un-awaited, so they cannot gate/mutate the call.
      if (event === 'provider_request') {
        const request = data as Record<string, unknown>;
        calledModel = { model: request['model'], provider: request['provider'] };
        fireModelCallHook(ctx, 'PreModelCall', request, hookTraceEnv);
      } else if (event === 'provider_response_normalized') {
        // Named after the model the request was last sent to, which answered it.
        fireModelCallHook(
          ctx,
          'PostModelCall',
          { ...(data as Record<string, unknown>), ...calledModel },
          hookTraceEnv,
        );
      } else if (event === PROVIDER_FALLBACK_EVENTS.SWITCHED) {
        const notice = readModelFallbackNotice(data as Record<string, unknown>);
        if (notice !== undefined) {
          // The call to the model that failed ends here, so its PreModelCall gets its PostModelCall
          // before the request is announced again for the next model.
          fireModelCallHook(
            ctx,
            'PostModelCall',
            { round: data['round'], model: notice.from.model, provider: notice.from.provider },
            hookTraceEnv,
          );
          ctx.emitProviderFallback?.(notice);
        }
      } else if (event === PROVIDER_CALL_EVENTS.COMPLETED && ctx.emitProviderCallCompleted) {
        // Forward an allowlist, not the generic event envelope, across the session boundary.
        const observation = data as Record<string, unknown>;
        if (
          Number.isSafeInteger(observation['round']) &&
          (observation['round'] as number) > 0 &&
          typeof observation['startedAt'] === 'string' &&
          typeof observation['endedAt'] === 'string' &&
          (observation['outcome'] === 'success' ||
            observation['outcome'] === 'failure' ||
            observation['outcome'] === 'interrupted')
        ) {
          ctx.emitProviderCallCompleted({
            round: observation['round'] as number,
            startedAt: observation['startedAt'],
            endedAt: observation['endedAt'],
            outcome: observation['outcome'],
            ...(typeof observation['callId'] === 'string' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                observation['callId'],
              ) && { callId: observation['callId'] }),
            ...((observation['disposition'] === 'invoked' ||
              observation['disposition'] === 'cache-hit' ||
              observation['disposition'] === 'preflight-refused') && {
              disposition: observation['disposition'],
            }),
            ...(typeof observation['providerId'] === 'string' &&
              observation['providerId'].length > 0 &&
              observation['providerId'].length <= 128 &&
              [...observation['providerId']].every((char) => char.charCodeAt(0) >= 32) && {
                providerId: observation['providerId'],
              }),
            ...(typeof observation['modelId'] === 'string' &&
              observation['modelId'].length > 0 &&
              observation['modelId'].length <= 128 &&
              [...observation['modelId']].every((char) => char.charCodeAt(0) >= 32) && {
                modelId: observation['modelId'],
              }),
            ...((observation['usageProvenance'] === 'complete' ||
              observation['usageProvenance'] === 'partial' ||
              observation['usageProvenance'] === 'absent') && {
              usageProvenance: observation['usageProvenance'],
            }),
            ...(observation['usageProvenance'] === 'complete' &&
              typeof observation['promptTokens'] === 'number' &&
              Number.isSafeInteger(observation['promptTokens']) &&
              observation['promptTokens'] >= 0 &&
              typeof observation['completionTokens'] === 'number' &&
              Number.isSafeInteger(observation['completionTokens']) &&
              observation['completionTokens'] >= 0 &&
              typeof observation['totalTokens'] === 'number' &&
              Number.isSafeInteger(observation['totalTokens']) &&
              observation['totalTokens'] ===
                observation['promptTokens'] + observation['completionTokens'] && {
                promptTokens: observation['promptTokens'],
                completionTokens: observation['completionTokens'],
                totalTokens: observation['totalTokens'],
              }),
            ...(observation['disposition'] === 'invoked' &&
              typeof observation['providerRequestId'] === 'string' && {
                providerRequestId: observation['providerRequestId'],
              }),
          });
        }
      }
      // BEHAVIOR-002: recompute and emit context per agentic round so the status bar
      // climbs live during a turn instead of jumping once at completion. The agent loop
      // runs entirely inside this single agent.run() call; assistant_message_committed
      // fires once per round with the round's usage already committed to history, which is
      // the right cadence — frequent enough to feel live, sparse enough to avoid render flooding.
      if (event === 'assistant_message_committed') {
        ctx.contextTracker.updateFromHistory(ctx.agent.getHistory());
        ctx.onContextUpdate?.(ctx.contextTracker.getContextState());
      }
    },
    ...(onTextDelta && { onTextDelta }),
  };
}
