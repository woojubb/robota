import { randomUUID } from 'node:crypto';

import { createHostCredentialStore } from '../credentials/select-credential-store.js';
import { openInBrowser } from './browser-opener.js';
import { acquireOpenRouterKey } from './openrouter-oauth.js';
import { loadOrgPolicy } from '@robota-sdk/agent-framework';
import { userLocalStorageRoot, userPaths } from '../product/user-paths.js';

import type {
  ICredentialKey,
  ICredentialStore,
  TProviderCredentialResolver,
} from '@robota-sdk/agent-core';
import type {
  IOrgPolicy,
  IProviderConnectionHost,
  TProviderConnectionStage,
} from '@robota-sdk/agent-framework';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

const SERVICE = 'robota.provider.openrouter';
const ENDPOINT = 'https://openrouter.ai/api/v1';
const CONNECTION_TIMEOUT_MS = 5 * 60_000;

export interface IOpenRouterConnectionHostOptions {
  readonly root: string;
  readonly serviceNamespace: string;
  readonly notify?: (message: string) => void;
  readonly store?: ICredentialStore;
  readonly fetch?: typeof fetch;
  readonly acquireKey?: typeof acquireOpenRouterKey;
  readonly openBrowser?: (url: URL) => Promise<void>;
  readonly requireApiKeyFromEnv?: boolean;
}

export interface IOpenRouterConnectionHost extends IProviderConnectionHost {
  readonly resolveCredential: TProviderCredentialResolver;
  /** In-process redaction only; never project these values into settings or transport state. */
  getResolvedSecrets(): readonly string[];
  shutdown(): void;
}

/** The normal CLI and its eval entry share the same lazily selected host credential backend. */
export function createCliOpenRouterConnectionHost(
  runtime: ICliRuntimeContext,
  orgPolicy: IOrgPolicy | null = loadOrgPolicy(userPaths(runtime).orgPolicy),
): IOpenRouterConnectionHost {
  return createOpenRouterConnectionHost({
    root: userLocalStorageRoot(runtime),
    serviceNamespace: runtime.config.credentials.serviceNamespace,
    notify: (message) => process.stderr.write(`${message}\n`),
    requireApiKeyFromEnv: orgPolicy?.requireApiKeyFromEnv,
  });
}

/** Authentication and secret resolution belong to the local host, shared by its CLI and App. */
export function createOpenRouterConnectionHost(
  options: IOpenRouterConnectionHostOptions,
): IOpenRouterConnectionHost {
  const store =
    options.store ??
    createHostCredentialStore({
      root: options.root,
      serviceNamespace: options.serviceNamespace,
      notify: options.notify ?? (() => {}),
    }).store;
  const network = options.fetch ?? fetch;
  const active = new Map<string, AbortController>();
  const resolvedSecrets = new Set<string>();
  let stopped = false;

  const policyCheck = (): void => {
    if (options.requireApiKeyFromEnv === true) {
      throw new Error(
        'Your organization requires environment variable API key references. Use API key setup with $ENV:VARIABLE_NAME.',
      );
    }
  };

  return {
    async connect(request, persist) {
      if (stopped)
        throw new Error('OpenRouter connection cancelled because this host is shutting down.');
      policyCheck();
      if (request.type !== 'openrouter')
        throw new Error('Browser and stored-key setup are available only for OpenRouter.');
      if (request.method !== 'browser' && request.method !== 'api-key')
        throw new Error('Choose Browser or API key setup for OpenRouter.');
      if (active.has(request.profile))
        throw new Error(
          'An OpenRouter connection attempt is already running for this profile. Cancel it before trying again.',
        );
      const controller = new AbortController();
      const cancel = (): void => controller.abort();
      request.signal?.addEventListener('abort', cancel, { once: true });
      if (request.signal?.aborted) controller.abort();
      active.set(request.profile, controller);
      const timer = setTimeout(cancel, CONNECTION_TIMEOUT_MS);
      timer.unref();
      const status: { stage: TProviderConnectionStage } = { stage: 'awaiting-approval' };
      let staged: ICredentialKey | undefined;
      let committed = false;
      let browserKeyIssued = false;
      let administrativeKey = false;
      const progress = (next: TProviderConnectionStage): void => {
        status.stage = next;
        request.onProgress?.(next);
      };
      try {
        controller.signal.throwIfAborted();
        const secret =
          request.method === 'browser'
            ? await (options.acquireKey ?? acquireOpenRouterKey)({
                openBrowser: options.openBrowser ?? openInBrowser,
                fetch: network,
                signal: controller.signal,
                onProgress: (next) =>
                  progress(next === 'waiting-for-browser' ? 'awaiting-approval' : 'exchanging'),
              })
            : request.apiKey?.trim();
        browserKeyIssued =
          request.method === 'browser' && typeof secret === 'string' && secret.length > 0;
        controller.signal.throwIfAborted();
        if (!secret || secret.startsWith('$ENV:')) {
          throw new Error('A new literal OpenRouter API key is required for host storage.');
        }
        resolvedSecrets.add(secret);
        progress('validating');
        const response = await network(`${ENDPOINT}/key`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${secret}` },
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('OpenRouter credential validation failed.');
        const result: unknown = await response.json();
        if (
          typeof result !== 'object' ||
          result === null ||
          !('data' in result) ||
          typeof result.data !== 'object' ||
          result.data === null
        ) {
          throw new Error('OpenRouter credential validation failed.');
        }
        administrativeKey =
          ('is_management_key' in result.data && result.data.is_management_key === true) ||
          ('is_provisioning_key' in result.data && result.data.is_provisioning_key === true);
        if (administrativeKey) throw new Error('OpenRouter requires a model API key.');
        controller.signal.throwIfAborted();
        progress('saving');
        // Each attempt owns a new secret, so a failed replacement cannot delete an old or duplicated one.
        staged = { service: SERVICE, account: `connection-${randomUUID()}` };
        await store.set(staged, secret);
        controller.signal.throwIfAborted();
        await persist(staged, controller.signal);
        // The persistence callback checks cancellation/staleness immediately before its settings write.
        // Its successful completion commits the reference: later cancellation must retain that key.
        committed = true;
        return staged;
      } catch {
        let cleanupFailed = false;
        if (staged !== undefined && !committed) {
          try {
            await store.delete(staged);
          } catch {
            cleanupFailed = true;
          }
        }
        const reason = controller.signal.aborted
          ? 'OpenRouter connection cancelled.'
          : administrativeKey
            ? 'OpenRouter management keys cannot call models. Choose an ordinary OpenRouter API key.'
            : status.stage === 'validating'
              ? 'OpenRouter credential validation failed.'
              : status.stage === 'saving'
                ? 'OpenRouter connection could not be saved.'
                : 'OpenRouter browser connection could not be completed.';
        const recovery = browserKeyIssued
          ? 'The newly issued key may still exist in OpenRouter. Review or revoke it on OpenRouter Keys (https://openrouter.ai/keys). '
          : '';
        throw new Error(
          `${reason} ${cleanupFailed ? 'The temporary host credential could not be removed. ' : ''}${recovery}Try /provider reconnect <profile>, or use API key setup.`,
        );
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', cancel);
        active.delete(request.profile);
      }
    },
    async resolveCredential(config) {
      const ref = config.apiKeyRef;
      if (ref === undefined) return config;
      policyCheck();
      if (
        config.name !== 'openrouter' ||
        config.baseURL !== ENDPOINT ||
        ref.service !== SERVICE ||
        typeof ref.account !== 'string' ||
        ref.account.length === 0
      ) {
        throw new Error(
          'This stored OpenRouter credential is not bound to the selected service and endpoint. Use /provider reconnect <profile>.',
        );
      }
      let secret: string | undefined;
      try {
        secret = await store.get(ref);
      } catch {
        throw new Error(
          'The saved OpenRouter credential is unavailable on this host. Use /provider reconnect <profile>.',
        );
      }
      if (!secret)
        throw new Error(
          'The saved OpenRouter credential was not found on this host. Use /provider reconnect <profile>.',
        );
      resolvedSecrets.add(secret);
      return { ...config, apiKey: secret };
    },
    getResolvedSecrets: () => [...resolvedSecrets],
    shutdown: () => {
      stopped = true;
      for (const controller of active.values()) controller.abort();
    },
  };
}
