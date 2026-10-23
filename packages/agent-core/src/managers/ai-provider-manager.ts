import { AbstractManager } from '../abstracts/abstract-manager';
import { ConfigurationError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { Validator } from '../utils/validation';

import type { IAIProviderManager } from '../interfaces/manager';
import type {
  IAIProvider,
  IProviderRegistrationOptions,
  TProviderOwnership,
} from '../interfaces/provider';

/**
 * AI Provider Manager - manages AI provider instances
 * Manages registration, selection, and state of AI providers
 * Instance-based for isolated provider management
 * @internal
 */
export class AIProviders extends AbstractManager implements IAIProviderManager {
  private providers = new Map<string, { provider: IAIProvider; ownership: TProviderOwnership }>();
  private retirements = new Set<Promise<void>>();
  private closing = new WeakMap<IAIProvider, Promise<void>>();
  private currentProvider: string | undefined;
  private currentModel: string | undefined;

  constructor() {
    // CORE-045: same as the tool registry — `doInitialize` only logs, so there is no asynchronous
    // state a caller could race, and refusing until the first run made `swapDefaultProvider()`
    // throw on every freshly constructed agent.
    super({ readyOnConstruction: true });
  }

  /**
   * Initialize the manager
   */
  protected async doInitialize(): Promise<void> {
    logger.debug('AIProviders initialized');
  }

  /**
   * Cleanup manager resources
   */
  protected async doDispose(): Promise<void> {
    const registrations = [...this.providers.entries()];
    this.providers.clear();
    this.initialized = false;
    this.currentProvider = undefined;
    this.currentModel = undefined;
    for (const [name, registration] of registrations) {
      if (registration.ownership === 'owned') this.retire(name, registration.provider);
    }
    await Promise.all(this.retirements);

    logger.debug('AIProviders disposed');
  }

  private retire(name: string, provider: IAIProvider): void {
    if (this.closing.has(provider)) return;
    const retirement = Promise.resolve()
      .then(() => provider.close?.())
      .catch((error: unknown) => {
        logger.warn(`Failed to close AI provider ${name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.retirements.delete(retirement);
        this.closing.delete(provider);
      });
    this.closing.set(provider, retirement);
    this.retirements.add(retirement);
  }

  /**
   * Register an AI provider
   */
  addProvider(
    name: string,
    provider: IAIProvider,
    options: IProviderRegistrationOptions = {},
  ): void {
    this.ensureInitialized();

    // Validate provider name
    const nameValidation = Validator.validateProviderName(name);
    if (!nameValidation.isValid) {
      throw new ValidationError(`Invalid provider name: ${nameValidation.errors.join(', ')}`);
    }

    // Validate provider
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      throw new ValidationError('Provider must be a valid object instance');
    }

    if (!provider.name || typeof provider.name !== 'string') {
      throw new ValidationError('Provider must have a valid name');
    }

    if (typeof provider.chat !== 'function') {
      throw new ValidationError('Provider must have a chat method');
    }

    const ownership = options.ownership === undefined ? 'owned' : options.ownership;
    if (ownership !== 'owned' && ownership !== 'borrowed') {
      throw new ValidationError('Provider ownership must be owned or borrowed');
    }

    // Check for duplicate registration
    if (this.providers.has(name)) {
      logger.warn(`Provider "${name}" is already registered, overriding`, {
        providerName: name,
        existingProvider: this.providers.get(name)?.provider.name,
      });
    }

    const previous = this.providers.get(name);
    this.providers.set(name, { provider, ownership });
    if (previous?.ownership === 'owned' && previous.provider !== provider) {
      this.retire(name, previous.provider);
    }
    logger.debug(`AI provider "${name}" registered successfully`, {
      providerName: name,
      version: provider.version,
      supportsStreaming: typeof provider.chatStream === 'function',
    });
  }

  /**
   * Remove an AI provider
   */
  removeProvider(name: string): void {
    this.ensureInitialized();

    if (!this.providers.has(name)) {
      logger.warn(`Attempted to remove non-existent provider "${name}"`);
      return;
    }

    const registration = this.providers.get(name);
    this.providers.delete(name);
    if (registration?.ownership === 'owned') this.retire(name, registration.provider);

    // Clear current selection if this was the current provider
    if (this.currentProvider === name) {
      this.currentProvider = undefined;
      this.currentModel = undefined;
      logger.debug(`Cleared current provider selection after removing "${name}"`);
    }

    logger.debug(`AI provider "${name}" removed successfully`);
  }

  /**
   * Get registered provider by name
   */
  getProvider(name: string): IAIProvider | undefined {
    this.ensureInitialized();
    return this.providers.get(name)?.provider;
  }

  /**
   * Get all registered providers
   */
  getProviders(): Record<string, IAIProvider> {
    this.ensureInitialized();
    return Object.fromEntries([...this.providers].map(([name, entry]) => [name, entry.provider]));
  }

  /**
   * Set current provider and model
   */
  setCurrentProvider(name: string, model: string): void {
    this.ensureInitialized();

    // Validate provider exists
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ConfigurationError(`Provider "${name}" is not registered`);
    }

    // Note: Model validation is now handled at runtime in ChatOptions
    // No pre-validation needed since models are provider-specific

    this.currentProvider = name;
    this.currentModel = model;

    logger.debug(`Current AI provider set to "${name}" with model "${model}"`);
  }

  /**
   * Get current provider and model
   */
  getCurrentProvider(): { provider: string; model: string } | undefined {
    this.ensureInitialized();

    if (!this.currentProvider || !this.currentModel) {
      return undefined;
    }

    return {
      provider: this.currentProvider,
      model: this.currentModel,
    };
  }

  /**
   * Check if provider is configured
   */
  isConfigured(): boolean {
    this.ensureInitialized();
    return !!(
      this.currentProvider &&
      this.currentModel &&
      this.providers.has(this.currentProvider)
    );
  }

  /**
   * Get current provider instance
   */
  getCurrentProviderInstance(): IAIProvider | undefined {
    if (!this.isConfigured() || !this.currentProvider) {
      return undefined;
    }

    return this.providers.get(this.currentProvider)?.provider;
  }

  /**
   * Get provider names
   */
  getProviderNames(): string[] {
    this.ensureInitialized();
    return Array.from(this.providers.keys());
  }

  /**
   * Get providers by pattern
   */
  getProvidersByPattern(pattern: string | RegExp): Record<string, IAIProvider> {
    this.ensureInitialized();

    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const result: Record<string, IAIProvider> = {};

    for (const [name, registration] of this.providers) {
      if (regex.test(name)) {
        result[name] = registration.provider;
      }
    }

    return result;
  }

  /**
   * Check if provider supports streaming
   */
  supportsStreaming(providerName?: string): boolean {
    this.ensureInitialized();

    const name = providerName || this.currentProvider;
    if (!name) {
      return false;
    }

    const provider = this.providers.get(name)?.provider;
    return !!(provider && typeof provider.chatStream === 'function');
  }

  /**
   * Get provider count
   */
  getProviderCount(): number {
    this.ensureInitialized();
    return this.providers.size;
  }
}
