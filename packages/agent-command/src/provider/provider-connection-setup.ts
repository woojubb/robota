import {
  ENV_REFERENCE_PREFIX,
  findProviderDefinition,
  isEnvReference,
  selectAction,
  textAction,
} from '@robota-sdk/agent-core';
import {
  buildProviderSetupPatch,
  formatOrgPolicyViolationMessage,
  mergeProviderPatch,
  suggestProviderProfileName,
} from '@robota-sdk/agent-framework';

import { runProviderSetupAsk } from './provider-setup-ask.js';

import type { ICredentialKey, IUserInteraction } from '@robota-sdk/agent-core';
import type {
  IProviderCommandModuleOptions,
  IProviderSetupInput,
  TProviderConnectionStage,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IProviderSetupFlowState } from './provider-setup-flow.js';

let nextAttempt = 0;
const STAGE_LABELS: Record<TProviderConnectionStage, string> = {
  'awaiting-approval': 'Waiting for browser approval',
  exchanging: 'Completing browser authentication',
  validating: 'Checking the connection',
  saving: 'Finishing connection setup',
};

export function hasProviderConnectionMethods(
  type: string,
  options: IProviderCommandModuleOptions,
): boolean {
  return (
    (findProviderDefinition(options.providerDefinitions, type)?.connectionMethods?.length ?? 0) > 0
  );
}

/** Both frontends acquire new keys through the host; settings retain references to stored keys. */
export async function runProviderConnectionSetup(
  ui: IUserInteraction,
  flow: IProviderSetupFlowState,
  options: IProviderCommandModuleOptions,
  isSetupRequired: boolean,
  replace = false,
): Promise<ICommandResult> {
  const definition = findProviderDefinition(options.providerDefinitions, flow.type);
  const profile =
    flow.profileName ??
    suggestProviderProfileName(
      { type: flow.type },
      { existingProfileNames: flow.existingProfileNames },
    );
  const initial = options.settings.readMergedSettings();
  const previous = initial.providers?.[profile];
  const previousSnapshot = JSON.stringify(previous);
  if (
    options.orgPolicy?.allowedProviders &&
    !options.orgPolicy.allowedProviders.includes(profile)
  ) {
    return {
      success: false,
      message: formatOrgPolicyViolationMessage(
        `Provider profile "${profile}" is not allowed by your organization policy.`,
        options.orgPolicy.adminContact,
      ),
    };
  }
  const methods = (definition?.connectionMethods ?? []).filter(
    (method) => options.orgPolicy?.requireApiKeyFromEnv !== true || method === 'api-key',
  );
  let description = options.orgPolicy?.requireApiKeyFromEnv
    ? formatOrgPolicyViolationMessage(
        'Your organization requires an environment reference such as $ENV:OPENROUTER_API_KEY.',
        options.orgPolicy.adminContact,
      )
    : undefined;
  for (;;) {
    const methodAnswer = await ui.ask(
      selectAction(
        'provider-connection-method',
        `Connect with ${definition?.displayName ?? flow.type}`,
        methods.map((method) => ({
          value: method,
          label: method === 'api-key' ? 'API key' : 'Browser',
        })),
        { description },
      ),
    );
    if (methodAnswer.type !== 'answer') return cancelled();
    const method = methodAnswer.values[0];
    if ((method !== 'api-key' && method !== 'browser') || !methods.includes(method))
      return cancelled();
    let apiKey: string | undefined;
    if (method === 'api-key') {
      const keyAnswer = await ui.ask(
        textAction('provider-connection-key', 'API key or $ENV:VARIABLE_NAME', {
          masked: true,
          allowEmpty: false,
        }),
      );
      if (keyAnswer.type !== 'answer') return cancelled();
      apiKey = keyAnswer.text?.trim();
      if (!apiKey || (options.orgPolicy?.requireApiKeyFromEnv && !isEnvReference(apiKey))) {
        description = options.orgPolicy?.requireApiKeyFromEnv
          ? formatOrgPolicyViolationMessage(
              'Enter an environment reference such as $ENV:OPENROUTER_API_KEY.',
              options.orgPolicy.adminContact,
            )
          : 'An API key is required.';
        continue;
      }
      if (isEnvReference(apiKey)) {
        const variable = apiKey.slice(ENV_REFERENCE_PREFIX.length).trim();
        if (!variable || !(options.env ?? process.env)[variable]?.trim()) {
          description =
            'The environment reference is unset or invalid. Set its variable, then choose API key to try again.';
          continue;
        }
      }
    }
    const controller = new AbortController();
    let progress: AbortController | undefined;
    let sequence = 0;
    const attempt = ++nextAttempt;
    const stopProgress = (): void => {
      progress?.abort();
      progress = undefined;
    };
    const onProgress = (stage: TProviderConnectionStage): void => {
      stopProgress();
      const prompt = new AbortController();
      progress = prompt;
      void ui
        .ask(
          selectAction(
            `provider-connection-progress-${attempt}-${++sequence}`,
            STAGE_LABELS[stage],
            [{ value: 'cancel', label: 'Cancel connection' }],
            { description: 'Keep this session open. You can cancel and choose API key setup.' },
          ),
          { signal: prompt.signal },
        )
        .then((response) => {
          if (response.type === 'answer' || !prompt.signal.aborted) controller.abort();
        })
        .catch(() => {
          if (!prompt.signal.aborted) controller.abort();
        });
    };
    let result: ICommandResult | undefined;
    const persist = async (reference?: ICredentialKey, hostSignal?: AbortSignal): Promise<void> => {
      stopProgress();
      const signal = hostSignal ?? controller.signal;
      let input: IProviderSetupInput | undefined;
      const modelFlow = {
        ...flow,
        profileName: profile,
        steps: flow.steps.filter((step) => step.key !== 'apiKey' && step.key !== 'baseURL'),
      };
      if (modelFlow.steps.length === 0) {
        input = {
          profile,
          type: flow.type,
          model: definition?.defaults?.model,
          setCurrent: flow.setCurrent ?? true,
        };
      } else {
        await runProviderSetupAsk(
          ui,
          modelFlow,
          (completed) => {
            input = completed;
            return { success: true, message: '' };
          },
          'Provider connection cancelled.',
          signal,
        );
      }
      if (!input || signal.aborted || controller.signal.aborted) {
        controller.abort();
        throw new Error('Provider connection cancelled.');
      }
      const current = options.settings.readMergedSettings();
      if (
        JSON.stringify(current.providers?.[profile]) !== previousSnapshot ||
        current.currentProvider !== initial.currentProvider
      ) {
        throw new Error('Provider connection changed while setup was pending.');
      }
      const credential =
        reference === undefined
          ? { apiKeyEnv: apiKey?.slice(ENV_REFERENCE_PREFIX.length).trim() }
          : { apiKeyRef: reference };
      const patch = buildProviderSetupPatch(
        { ...input, ...credential },
        {
          providerDefinitions: options.providerDefinitions,
          env: options.env,
        },
      );
      if (replace && previous !== undefined) {
        const retained = { ...previous };
        delete retained.apiKey;
        delete retained.apiKeyRef;
        patch.providers[profile] = { ...retained, ...patch.providers[profile] };
      }
      options.settings.writeTargetSettings(
        mergeProviderPatch(options.settings.readTargetSettings(), patch),
      );
      const active = initial.currentProvider === profile;
      result = {
        success: true,
        message: `Provider ${profile} connected.`,
        ...(replace
          ? active
            ? {
                hostActions: [
                  {
                    type: 'session-restart',
                    reason: 'other',
                    message: 'Provider connection restart',
                  } as const,
                ],
              }
            : {}
          : {
              hostActions: isSetupRequired
                ? [{ type: 'provider-hot-swap', profileName: profile } as const]
                : [
                    {
                      type: 'session-restart',
                      reason: 'other',
                      message: 'Provider setup restart',
                    } as const,
                  ],
            }),
      };
    };
    try {
      if (apiKey !== undefined && isEnvReference(apiKey)) {
        await persist();
      } else if (options.connectionHost === undefined) {
        description =
          'Host connection support is unavailable. Choose API key and use an environment reference.';
        continue;
      } else {
        await options.connectionHost.connect(
          {
            type: flow.type,
            profile,
            method,
            ...(apiKey === undefined ? {} : { apiKey }),
            signal: controller.signal,
            ...(method === 'browser' ? { onProgress } : {}),
          },
          persist,
        );
      }
      if (result === undefined) throw new Error('The host did not save a connection.');
      return result;
    } catch {
      const recovery =
        method === 'browser' && flow.type === 'openrouter'
          ? ' If OpenRouter issued a key during this attempt, it may remain in your account. Review OpenRouter Keys at https://openrouter.ai/keys.'
          : '';
      if (controller.signal.aborted) {
        description = `Connection cancelled. Choose a connection method to try again.${recovery}`;
        continue;
      }
      return {
        success: false,
        message: `Connection failed. Retry with ${replace ? `/provider reconnect ${profile}` : `/provider add ${flow.type}`} and choose ${flow.type === 'openrouter' ? 'an ordinary OpenRouter API key or Browser' : 'API key or Browser'}.${recovery}`,
      };
    } finally {
      stopProgress();
    }
  }
}

function cancelled(): ICommandResult {
  return { success: true, message: 'Provider connection cancelled.' };
}
