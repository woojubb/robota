import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

import { getPlaygroundSessionStore } from '../../session/persistent-session-store.js';
import { addSession } from '../../session/playground-session-store.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IResolvedConfig, ICommandModule } from '@robota-sdk/agent-framework';
import type { Request, Response } from 'express';

export interface IRestoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ENV_KEY_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

function createProvider(providerName: string, apiKey: string): IAIProvider {
  switch (providerName) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey });
    case 'openai':
      return new OpenAIProvider({ apiKey, defaultModel: '' });
    case 'gemini':
      return new GeminiProvider({ apiKey });
    case 'deepseek':
      return new DeepSeekProvider({ apiKey });
    default:
      throw new Error(`Unsupported provider: ${providerName}`);
  }
}

interface ISkillEntry {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  skillMdContent?: unknown;
}

interface ISessionCreateBody {
  provider?: unknown;
  model?: unknown;
  systemPrompt?: unknown;
  permissionMode?: unknown;
  maxTurns?: unknown;
  skills?: unknown;
  resumeSessionId?: unknown;
}

function buildSkillCommandModule(skills: ISkillEntry[]): ICommandModule {
  const commands = skills
    .filter(
      (s): s is { id: string; name: string; description: string; skillMdContent: string } =>
        typeof s.skillMdContent === 'string' &&
        typeof s.name === 'string' &&
        typeof s.description === 'string',
    )
    .map((s) => ({
      name: typeof s.id === 'string' && s.id ? s.id : s.name,
      description: s.description,
      source: 'skill' as const,
      skillContent: s.skillMdContent,
    }));

  return {
    name: 'playground-skills',
    commandSources: [
      {
        name: 'skill',
        getCommands() {
          return commands;
        },
      },
    ],
  };
}

export async function playgroundSessionCreateHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as ISessionCreateBody;
  const {
    provider: providerName,
    model,
    systemPrompt,
    permissionMode,
    maxTurns,
    skills,
    resumeSessionId,
  } = body;

  if (typeof providerName !== 'string' || !providerName) {
    res.status(400).json({ error: 'Missing or invalid "provider" field' });
    return;
  }
  if (typeof model !== 'string' || !model) {
    res.status(400).json({ error: 'Missing or invalid "model" field' });
    return;
  }

  const apiKey =
    req.byokKey ??
    (ENV_KEY_MAP[providerName] ? process.env[ENV_KEY_MAP[providerName] ?? ''] : undefined);

  if (!apiKey) {
    res.status(400).json({ error: `No API key available for provider: ${providerName}` });
    return;
  }

  const config: IResolvedConfig = {
    defaultTrustLevel: 'full',
    provider: {
      name: providerName,
      model,
      apiKey: undefined, // API key is in the provider instance, not config
    },
    permissions: { allow: [], deny: [] },
    env: {},
  };

  const resolvedPermissionMode =
    typeof permissionMode === 'string' &&
    ['bypassPermissions', 'default', 'acceptEdits', 'plan'].includes(permissionMode)
      ? (permissionMode as 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan')
      : 'bypassPermissions';

  const resolvedMaxTurns = typeof maxTurns === 'number' && maxTurns > 0 ? maxTurns : undefined;

  const provider = createProvider(providerName, apiKey);

  const commandModules: ICommandModule[] = [];
  if (Array.isArray(skills) && skills.length > 0) {
    commandModules.push(buildSkillCommandModule(skills as ISkillEntry[]));
  }

  const sessionStore = getPlaygroundSessionStore();

  const resolvedResumeSessionId =
    typeof resumeSessionId === 'string' && resumeSessionId ? resumeSessionId : undefined;

  const restoredMessages: IRestoredMessage[] = [];
  if (resolvedResumeSessionId) {
    const record = sessionStore.load(resolvedResumeSessionId);
    if (record) {
      for (const msg of record.messages) {
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content
                  .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                  .map((p) => p.text)
                  .join('')
              : '';
        if (content) restoredMessages.push({ role: msg.role, content });
      }
    }
  }

  const session = new InteractiveSession({
    cwd: process.cwd(),
    provider,
    permissionMode: resolvedPermissionMode,
    maxTurns: resolvedMaxTurns,
    bare: true,
    config,
    sessionStore,
    ...(resolvedResumeSessionId ? { resumeSessionId: resolvedResumeSessionId } : {}),
    ...(commandModules.length > 0 ? { commandModules } : {}),
    ...(typeof systemPrompt === 'string' && systemPrompt.trim().length > 0
      ? { systemPrompt: systemPrompt.trim() }
      : {}),
  });

  const sessionId = crypto.randomUUID();
  addSession(sessionId, session);

  res.json({ sessionId, messages: restoredMessages });
}
