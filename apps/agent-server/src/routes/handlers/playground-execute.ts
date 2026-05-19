import {
  createSystemMessage,
  createToolMessage,
  createUserMessage,
  type IAIProvider,
  type IChatOptions,
  type IToolSchema,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

import { getToolRegistry } from '../../catalog/tools.js';

import type { Request, Response } from 'express';

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
      return new OpenAIProvider({ apiKey });
    case 'gemini':
      return new GeminiProvider({ apiKey });
    case 'deepseek':
      return new DeepSeekProvider({ apiKey });
    default:
      throw new Error(`Unsupported provider: ${providerName}`);
  }
}

function sendEvent(res: Response, eventData: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(eventData)}\n\n`);
}

interface IHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

interface IExecuteRequestBody {
  provider?: unknown;
  model?: unknown;
  tools?: unknown;
  systemPrompt?: unknown;
  message?: unknown;
  history?: unknown;
}

export async function playgroundExecuteHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as IExecuteRequestBody;
  const { provider: providerName, model, tools: toolIds, systemPrompt, message, history } = body;

  if (typeof providerName !== 'string' || !providerName) {
    res.status(400).json({ error: 'Missing or invalid "provider" field' });
    return;
  }
  if (typeof message !== 'string' || !message) {
    res.status(400).json({ error: 'Missing or invalid "message" field' });
    return;
  }

  const apiKey =
    req.byokKey ??
    (ENV_KEY_MAP[providerName] ? process.env[ENV_KEY_MAP[providerName] ?? ''] : undefined);

  if (!apiKey) {
    res.status(400).json({ error: `No API key available for provider: ${providerName}` });
    return;
  }

  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const provider = createProvider(providerName, apiKey);
    const toolRegistry = getToolRegistry();

    // Resolve requested tools into IToolSchema[]
    const resolvedToolIds = Array.isArray(toolIds)
      ? toolIds.filter((t) => typeof t === 'string')
      : [];
    const toolSchemas: IToolSchema[] = resolvedToolIds
      .map((id) => toolRegistry.get(id))
      .filter((entry) => entry !== undefined)
      .map((entry) => ({
        name: entry!.id,
        description: entry!.description,
        parameters: entry!.inputSchema as IToolSchema['parameters'],
      }));

    // Build initial message list
    const messages: TUniversalMessage[] = [];

    if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
      messages.push(createSystemMessage(systemPrompt.trim()));
    }

    // Append history
    if (Array.isArray(history)) {
      for (const item of history) {
        const h = item as IHistoryItem;
        if (h.role === 'user' && typeof h.content === 'string') {
          messages.push(createUserMessage(h.content));
        } else if (h.role === 'assistant' && typeof h.content === 'string') {
          // Build a minimal assistant message inline
          messages.push({
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: h.content,
            state: 'complete' as const,
            timestamp: new Date(),
          });
        }
      }
    }

    messages.push(createUserMessage(message));

    const chatOptions: IChatOptions = {
      model: typeof model === 'string' ? model : undefined,
      tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      onTextDelta: (delta: string) => {
        sendEvent(res, { type: 'text_delta', data: { text: delta } });
      },
    };

    // Tool-calling loop
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (;;) {
      const response = await provider.chat(messages, chatOptions);
      messages.push(response);

      // Accumulate usage if available
      if ('usage' in response && response.usage != null) {
        const u = response.usage as {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        };
        totalUsage.promptTokens += u.promptTokens ?? 0;
        totalUsage.completionTokens += u.completionTokens ?? 0;
        totalUsage.totalTokens += u.totalTokens ?? 0;
      }

      const toolCalls =
        'toolCalls' in response && Array.isArray(response.toolCalls) ? response.toolCalls : [];

      if (toolCalls.length === 0) {
        // No more tool calls — done
        break;
      }

      // Execute each tool call
      for (const toolCall of toolCalls) {
        const { id, function: fn } = toolCall;
        const toolEntry = toolRegistry.get(fn.name);

        sendEvent(res, {
          type: 'tool_call_start',
          data: { id, name: fn.name, input: JSON.parse(fn.arguments || '{}') },
        });

        let output: unknown;
        if (toolEntry) {
          try {
            output = await toolEntry.execute(JSON.parse(fn.arguments || '{}'));
          } catch (err) {
            output = {
              error: err instanceof Error ? err.message : 'Tool execution failed',
            };
          }
        } else {
          output = { error: `Unknown tool: ${fn.name}` };
        }

        sendEvent(res, { type: 'tool_call_complete', data: { id, output } });

        messages.push(createToolMessage(JSON.stringify(output), { toolCallId: id, name: fn.name }));
      }
    }

    sendEvent(res, { type: 'done', data: { usage: totalUsage } });
  } catch (err) {
    sendEvent(res, {
      type: 'error',
      data: { message: err instanceof Error ? err.message : 'Execution failed' },
    });
  } finally {
    res.end();
  }
}
