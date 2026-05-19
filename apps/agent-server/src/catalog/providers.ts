export interface IModelEntry {
  id: string;
  name: string;
  contextWindow: number;
  supportsTools: boolean;
}

export interface IProviderEntry {
  id: string;
  name: string;
  serverKeyAvailable: boolean;
  byokSupported: boolean;
  models: IModelEntry[];
}

export interface IProviderCatalogResponse {
  providers: IProviderEntry[];
}

const PROVIDER_DEFINITIONS: Omit<IProviderEntry, 'serverKeyAvailable'>[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    byokSupported: true,
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, supportsTools: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, supportsTools: true },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, supportsTools: true },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextWindow: 16385, supportsTools: true },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    byokSupported: true,
    models: [
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        contextWindow: 200000,
        supportsTools: true,
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        contextWindow: 200000,
        supportsTools: true,
      },
      {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        contextWindow: 200000,
        supportsTools: true,
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    byokSupported: true,
    models: [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        contextWindow: 1048576,
        supportsTools: true,
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        contextWindow: 2097152,
        supportsTools: true,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    byokSupported: true,
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        contextWindow: 128000,
        supportsTools: true,
      },
    ],
  },
];

const ENV_KEY_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

export function getProviderCatalog(): IProviderCatalogResponse {
  const providers = PROVIDER_DEFINITIONS.map((def) => ({
    ...def,
    serverKeyAvailable: Boolean(process.env[ENV_KEY_MAP[def.id] ?? '']),
  }));
  return { providers };
}
