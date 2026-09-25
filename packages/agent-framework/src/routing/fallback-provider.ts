/**
 * A provider that answers on the next model of an ordered chain when the one it is on fails in a way
 * another model could serve.
 *
 * It sits in front of the one provider a session holds, so the round loop and everything that reads
 * "the" provider stay as they are. It receives the provider-neutral messages the loop already
 * converted and hands them on unchanged; turning history into provider messages is not its job.
 *
 * A run stays on the model that accepted it: the rounds already committed stay, later rounds of the
 * same run go straight to that model, and the next run starts on the primary again.
 */

import { classifyProviderFailure, findModelDefinition } from '@robota-sdk/agent-core';

import { runWithRoleFallback } from './role-model-routing.js';

import type {
  IAIProvider,
  IChatOptions,
  IModelRef,
  IProviderRequest,
  IRawProviderResponse,
  TProviderFailureReason,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

/** One model a request may move to, and how to reach it. */
export interface IFallbackModelTarget {
  /** The provider (vendor) and model this entry answers on. */
  ref: IModelRef;
  /** Build the provider for this entry. A throw means it cannot be reached, and the chain moves on. */
  create: () => IAIProvider;
}

export interface IFallbackProviderOptions {
  /** Context window of a model, or `undefined` when unknown. Defaults to the registered metadata. */
  contextWindowOf?: (model: string) => number | undefined;
  /** Told once per entry that could not be built. */
  onUnreachable?: (target: IFallbackModelTarget, error: unknown) => void;
}

/** How many runs remember the model they moved to. Older runs have long finished. */
const REMEMBERED_RUNS = 64;

class UnreachableFallbackError extends Error {
  constructor(
    readonly target: IFallbackModelTarget,
    cause: unknown,
  ) {
    super(`Fallback model ${target.ref.model} (${target.ref.provider}) could not be reached`, {
      cause,
    });
    this.name = 'UnreachableFallbackError';
  }
}

type TBuilt = { provider: IAIProvider } | { error: unknown };

export class FallbackProvider implements IAIProvider {
  readonly name: string;
  readonly version: string;
  private readonly built = new Map<number, TBuilt>();
  /** Chain position each recent run moved to; a run not listed is on the primary. */
  private readonly runPositions = new Map<string, number>();
  private readonly contextWindowOf: (model: string) => number | undefined;

  capabilityTable?: IAIProvider['capabilityTable'];
  effortTable?: IAIProvider['effortTable'];
  endpointIsVendorDefault?: IAIProvider['endpointIsVendorDefault'];
  canPropagateTraceContext?: IAIProvider['canPropagateTraceContext'];
  configureNativeWebTools?: IAIProvider['configureNativeWebTools'];
  getCapabilities?: IAIProvider['getCapabilities'];

  constructor(
    private readonly primary: IAIProvider,
    private readonly fallbacks: readonly IFallbackModelTarget[],
    private readonly options: IFallbackProviderOptions = {},
  ) {
    this.name = primary.name;
    this.version = primary.version;
    this.contextWindowOf =
      options.contextWindowOf ?? ((model) => findModelDefinition(model)?.contextWindow);
    // What the loop asks of "the provider" is asked of the primary: its capabilities decide how the
    // request is assembled, and the request is assembled once. Only present when the primary has it,
    // because an absent method and one that answers nothing mean different things to the loop.
    if (primary.capabilityTable) this.capabilityTable = () => primary.capabilityTable?.();
    if (primary.effortTable) this.effortTable = () => primary.effortTable?.();
    if (primary.endpointIsVendorDefault) {
      this.endpointIsVendorDefault = () => primary.endpointIsVendorDefault?.() ?? false;
    }
    if (primary.canPropagateTraceContext) {
      this.canPropagateTraceContext = () => primary.canPropagateTraceContext?.() ?? false;
    }
    if (primary.configureNativeWebTools) {
      this.configureNativeWebTools = (request) => primary.configureNativeWebTools!(request);
    }
    if (primary.getCapabilities) this.getCapabilities = () => primary.getCapabilities!();
  }

  /** The models a request may move to, in order. */
  get chain(): readonly IModelRef[] {
    return this.fallbacks.map((target) => target.ref);
  }

  resolveModelRoute(model: string, executionId?: string): IModelRef {
    return this.refAt(this.startPosition(executionId), model);
  }

  async chat(
    messages: TUniversalMessage[],
    options: IChatOptions = {},
  ): Promise<TUniversalMessage> {
    const model = options.model;
    if (model === undefined || this.fallbacks.length === 0) {
      return this.primary.chat(messages, delegatedOptions(options));
    }
    const { executionId, signal } = options;
    const positions = this.candidatePositions(model, options);
    const refs = positions.map((position) => this.refAt(position, model));
    const positionOf = new Map(refs.map((ref, index) => [ref, positions[index]!]));

    let streamed = false;
    const onTextDelta = options.onTextDelta;
    const watched: IChatOptions = {
      ...options,
      ...(onTextDelta && {
        onTextDelta: (delta: string) => {
          if (delta.length > 0) streamed = true;
          onTextDelta(delta);
        },
      }),
    };

    let failed: { ref: IModelRef; error: unknown; reason: TProviderFailureReason } | undefined;
    const run = async (ref: IModelRef): Promise<TUniversalMessage> => {
      const position = positionOf.get(ref)!;
      const provider = this.providerAt(position);
      if (failed !== undefined) {
        options.onModelFallback?.({ from: failed.ref, to: ref, reason: failed.reason });
      }
      try {
        const response = await provider.chat(
          messages,
          position === 0 ? delegatedOptions(watched) : this.fallbackOptions(watched, ref, provider),
        );
        this.remember(executionId, position);
        return response;
      } catch (error) {
        failed = { ref, error, reason: classifyProviderFailure(error, signal).reason };
        throw error;
      }
    };
    // Output already shown cannot be withdrawn, so a failure after it stands.
    const shouldRetry = (error: unknown): boolean =>
      error instanceof UnreachableFallbackError ||
      (!streamed && classifyProviderFailure(error, signal).switchable);

    try {
      return await runWithRoleFallback(refs, run, shouldRetry);
    } catch (error) {
      // An entry that could not be built says nothing about the request; the last real failure does.
      if (error instanceof UnreachableFallbackError && failed !== undefined) throw failed.error;
      throw error;
    }
  }

  generateResponse(payload: IProviderRequest): Promise<IRawProviderResponse> {
    return this.primary.generateResponse(payload);
  }

  supportsTools(): boolean {
    return this.primary.supportsTools();
  }

  validateConfig(): boolean {
    return this.primary.validateConfig();
  }

  async dispose(): Promise<void> {
    await this.primary.dispose?.();
    for (const built of this.built.values()) {
      if ('provider' in built) await built.provider.dispose?.();
    }
  }

  async close(): Promise<void> {
    await this.primary.close?.();
    for (const built of this.built.values()) {
      if ('provider' in built) await built.provider.close?.();
    }
  }

  private startPosition(executionId: string | undefined): number {
    if (executionId === undefined) return 0;
    return this.runPositions.get(executionId) ?? 0;
  }

  private refAt(position: number, model: string): IModelRef {
    if (position === 0) return { provider: this.primary.name, model };
    const { provider, model: fallbackModel } = this.fallbacks[position - 1]!.ref;
    return { provider, model: fallbackModel };
  }

  /**
   * The chain positions this request may use: from where its run stands, skipping any model whose
   * context window is smaller than the requested one's when the request asks for that.
   */
  private candidatePositions(model: string, options: IChatOptions): number[] {
    const positions: number[] = [];
    for (
      let position = this.startPosition(options.executionId);
      position <= this.fallbacks.length;
      position++
    ) {
      if (
        position > 0 &&
        options.preserveContextWindow === true &&
        !this.keepsContextWindow(model, this.fallbacks[position - 1]!.ref.model)
      ) {
        continue;
      }
      positions.push(position);
    }
    return positions;
  }

  private keepsContextWindow(requested: string, candidate: string): boolean {
    const candidateWindow = this.contextWindowOf(candidate);
    if (candidateWindow === undefined) return false;
    const requestedWindow = this.contextWindowOf(requested);
    return requestedWindow === undefined || candidateWindow >= requestedWindow;
  }

  private providerAt(position: number): IAIProvider {
    if (position === 0) return this.primary;
    const target = this.fallbacks[position - 1]!;
    let built = this.built.get(position);
    if (built === undefined) {
      try {
        built = { provider: target.create() };
      } catch (error) {
        built = { error };
        this.options.onUnreachable?.(target, error);
      }
      this.built.set(position, built);
    }
    if ('error' in built) throw new UnreachableFallbackError(target, built.error);
    return built.provider;
  }

  private remember(executionId: string | undefined, position: number): void {
    if (executionId === undefined) return;
    this.runPositions.delete(executionId);
    if (position === 0) return;
    this.runPositions.set(executionId, position);
    if (this.runPositions.size > REMEMBERED_RUNS) {
      const oldest = this.runPositions.keys().next().value;
      if (oldest !== undefined) this.runPositions.delete(oldest);
    }
  }

  /**
   * The request for another model: the same conversation, tools and settings, on that model. What
   * belongs to the primary's vendor stays behind — its hosted tools, its vendor option blocks and an
   * effort resolution made against its table — and a trace context goes only where it can be carried.
   */
  private fallbackOptions(
    options: IChatOptions,
    ref: IModelRef,
    provider: IAIProvider,
  ): IChatOptions {
    const {
      nativeWebTools: _nativeWebTools,
      openai: _openai,
      anthropic: _anthropic,
      google: _google,
      effortResolution: _effortResolution,
      outboundTraceContext,
      ...neutral
    } = delegatedOptions(options);
    return {
      ...neutral,
      model: ref.model,
      ...(outboundTraceContext !== undefined &&
        provider.canPropagateTraceContext?.() === true && { outboundTraceContext }),
    };
  }
}

/** Options for the provider behind this one: what only this decorator reads stays here. */
function delegatedOptions(options: IChatOptions): IChatOptions {
  const {
    onModelFallback: _onModelFallback,
    preserveContextWindow: _preserveContextWindow,
    ...rest
  } = options;
  return rest;
}
