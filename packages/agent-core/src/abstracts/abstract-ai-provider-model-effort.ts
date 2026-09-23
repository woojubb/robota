/** Generic raw-provider model-effort outcome assembly, separate from provider lifecycle code. */

import { isAssistantMessage } from '../interfaces/messages';
import {
  createModelEffortOutcome,
  resolveModelEffort,
} from '../interfaces/model-effort-capability';

import type { TUniversalMessage } from '../interfaces/messages';
import type {
  IModelEffortOutcome,
  IProviderModelEffortTable,
} from '../interfaces/model-effort-capability';
import type { IChatOptions, IProviderRequest } from '../interfaces/provider';
import type { IRawProviderResponse } from '../interfaces/provider';
import type { ILogger } from '../utils/logger';

interface IGenericRawResponseProvider {
  readonly name: string;
  chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage>;
  chatStream?(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage>;
  effortTable?(): IProviderModelEffortTable | undefined;
}

function createGenericChatOptions(
  payload: IProviderRequest,
  effortTable: (() => IProviderModelEffortTable | undefined) | undefined,
  logger: ILogger,
  captureTerminalOutcome: (outcome: IModelEffortOutcome) => void,
): IChatOptions {
  const shouldCaptureTerminalOutcome =
    payload.effort !== undefined || payload.effortResolution !== undefined;
  const observer = payload.onModelEffortOutcome;
  const onModelEffortOutcome = !shouldCaptureTerminalOutcome
    ? observer
    : (outcome: IModelEffortOutcome): void => {
        captureTerminalOutcome(outcome);
        if (observer === undefined) return;
        try {
          observer(outcome);
        } catch (error) {
          logger.warn('Model-effort outcome observer failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
  const options: IChatOptions = {
    ...(payload.model !== undefined && { model: payload.model }),
    ...(payload.effort !== undefined && { effort: payload.effort }),
    ...(payload.effortResolution !== undefined && { effortResolution: payload.effortResolution }),
    ...(onModelEffortOutcome !== undefined && { onModelEffortOutcome }),
    ...(payload.temperature !== undefined && { temperature: payload.temperature }),
    ...(payload.maxTokens !== undefined && { maxTokens: payload.maxTokens }),
    ...(payload.tools !== undefined && { tools: payload.tools }),
  };
  if (
    options.effort === undefined ||
    options.effortResolution !== undefined ||
    options.model === undefined
  ) {
    return options;
  }
  return {
    ...options,
    effortResolution: resolveModelEffort(effortTable?.(), options.model, options.effort),
  };
}

function publishGenericNoTableOutcome(
  options: IChatOptions,
  hasEffortTableAccessor: boolean,
  logger: ILogger,
): IModelEffortOutcome | undefined {
  if (hasEffortTableAccessor) return undefined;
  const resolution = options.effortResolution;
  const observer = options.onModelEffortOutcome;
  if (resolution === undefined || observer === undefined) return undefined;
  const outcome = createModelEffortOutcome(resolution, {
    nativeControl: { state: 'omitted', reason: 'model-effort-not-applied' },
    providerDispatch: { state: 'sent' },
  });
  try {
    observer(outcome);
  } catch (error) {
    logger.warn('Model-effort outcome observer failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return outcome;
}

function requireGenericTerminalOutcome(
  providerName: string,
  options: IChatOptions,
  terminalOutcome: IModelEffortOutcome | undefined,
): void {
  if (options.effort !== undefined && terminalOutcome === undefined) {
    throw new Error(
      `Provider "${providerName}" did not emit a model-effort terminal outcome for a selected generic request.`,
    );
  }
}

/** Adapt the common chat contract to one terminal raw response envelope. */
export async function generateGenericResponse(
  provider: IGenericRawResponseProvider,
  logger: ILogger,
  payload: IProviderRequest,
): Promise<IRawProviderResponse> {
  let terminalOutcome: IModelEffortOutcome | undefined;
  const options = createGenericChatOptions(
    payload,
    provider.effortTable?.bind(provider),
    logger,
    (outcome) => {
      terminalOutcome = outcome;
    },
  );
  const response = await provider.chat(payload.messages, options);
  terminalOutcome ??= publishGenericNoTableOutcome(
    options,
    provider.effortTable !== undefined,
    logger,
  );
  requireGenericTerminalOutcome(provider.name, options, terminalOutcome);

  return {
    content: response.content ?? null,
    toolCalls: isAssistantMessage(response) ? response.toolCalls : undefined,
    model: payload.model,
    metadata: payload.metadata,
    ...(terminalOutcome !== undefined && { modelEffortOutcome: terminalOutcome }),
  };
}

/** Adapt a common chat stream to message envelopes followed by one terminal raw envelope. */
export async function* generateGenericStreamingResponse(
  provider: IGenericRawResponseProvider,
  logger: ILogger,
  payload: IProviderRequest,
): AsyncIterable<IRawProviderResponse> {
  if (!provider.chatStream) {
    throw new Error(`[AI-PROVIDER] Streaming is not supported by provider "${provider.name}"`);
  }

  let terminalOutcome: IModelEffortOutcome | undefined;
  const options = createGenericChatOptions(
    payload,
    provider.effortTable?.bind(provider),
    logger,
    (outcome) => {
      terminalOutcome = outcome;
    },
  );
  for await (const chunk of provider.chatStream(payload.messages, options)) {
    yield {
      content: chunk.content ?? null,
      toolCalls: isAssistantMessage(chunk) ? chunk.toolCalls : undefined,
      model: payload.model,
      metadata: payload.metadata,
    };
  }
  terminalOutcome ??= publishGenericNoTableOutcome(
    options,
    provider.effortTable !== undefined,
    logger,
  );
  requireGenericTerminalOutcome(provider.name, options, terminalOutcome);
  if (terminalOutcome !== undefined) {
    yield {
      content: null,
      model: payload.model,
      metadata: payload.metadata,
      modelEffortOutcome: terminalOutcome,
    };
  }
}
