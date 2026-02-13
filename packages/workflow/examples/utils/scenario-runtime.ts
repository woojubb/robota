import type { IAIProvider } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import type { IScenarioProviderFromEnvOptions, TScenarioProviderFromEnvResult, TScenarioPlayStrategy } from '@robota-sdk/workflow/scenario';
import { createScenarioProviderFromEnv } from '@robota-sdk/workflow/scenario';

interface IScenarioRuntimeOptions {
    createProviderForRecord: () => IAIProvider;
    providerName: string;
    providerVersion: string;
    defaultPlayStrategy: TScenarioPlayStrategy;
    scenarioOptions: Omit<IScenarioProviderFromEnvOptions, 'delegate' | 'providerName' | 'providerVersion' | 'defaultPlayStrategy'>;
}

export interface IScenarioRuntimeResult {
    scenario: TScenarioProviderFromEnvResult;
    recordDelegateProvider?: IAIProvider;
}

export function createScenarioRuntime(options: IScenarioRuntimeOptions): IScenarioRuntimeResult {
    const hasRecordId = Boolean(process.env.SCENARIO_RECORD_ID?.trim());
    const hasPlayId = Boolean(process.env.SCENARIO_PLAY_ID?.trim());

    if (!hasRecordId && !hasPlayId) {
        throw new Error(
            '[SCENARIO-GUARD] Missing scenario mode. Set SCENARIO_RECORD_ID or SCENARIO_PLAY_ID explicitly.'
        );
    }

    const recordDelegateProvider = hasRecordId ? options.createProviderForRecord() : undefined;
    const scenario = createScenarioProviderFromEnv({
        ...options.scenarioOptions,
        delegate: recordDelegateProvider,
        providerName: options.providerName,
        providerVersion: options.providerVersion,
        defaultPlayStrategy: options.defaultPlayStrategy
    });
    return {
        scenario,
        ...(recordDelegateProvider ? { recordDelegateProvider } : undefined)
    };
}

export function createOpenAIProviderForRecordFromEnv(): IAIProvider {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        throw new Error(
            '[SCENARIO-RECORD] Missing OPENAI_API_KEY for record mode. Provide a real provider credential.'
        );
    }

    const baseURL = process.env.OPENAI_BASE_URL?.trim();
    const organization = process.env.OPENAI_ORGANIZATION?.trim();

    return new OpenAIProvider({
        apiKey,
        ...(baseURL ? { baseURL } : undefined),
        ...(organization ? { organization } : undefined)
    });
}
