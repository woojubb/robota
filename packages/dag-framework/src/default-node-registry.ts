import type { IDagNodeDefinition } from '@robota-sdk/dag-core';
import { InputNodeDefinition } from '@robota-sdk/dag-node-input';
import { MultiInputNodeDefinition } from '@robota-sdk/dag-node-multi-input';
import { TransformNodeDefinition } from '@robota-sdk/dag-node-transform';
import { TextTemplateNodeDefinition } from '@robota-sdk/dag-node-text-template';
import { TextOutputNodeDefinition } from '@robota-sdk/dag-node-text-output';
import { ImageLoaderNodeDefinition } from '@robota-sdk/dag-node-image-loader';
import { ImageSourceNodeDefinition } from '@robota-sdk/dag-node-image-source';
import { OkEmitterNodeDefinition } from '@robota-sdk/dag-node-ok-emitter';
import { ToolNodeDefinition } from '@robota-sdk/dag-node-tool';
import {
  StringToNumberNodeDefinition,
  NumberToStringNodeDefinition,
  TextJoinNodeDefinition,
  TextSplitNodeDefinition,
  TextReplaceNodeDefinition,
  TextLengthNodeDefinition,
  TextUpperNodeDefinition,
  TextLowerNodeDefinition,
  TextTrimNodeDefinition,
  JsonExtractNodeDefinition,
  ConditionalTextNodeDefinition,
  TextCountLinesNodeDefinition,
  TextRepeatNodeDefinition,
  TextSliceNodeDefinition,
} from '@robota-sdk/dag-node-utility-text';

/**
 * Returns the set of node definitions that have no optional provider-SDK
 * peer dependencies. These nodes always succeed to construct and are safe
 * to register without runtime feature detection.
 */
export function createDefaultNodeRegistrySync(): IDagNodeDefinition[] {
  return [
    new InputNodeDefinition(),
    new MultiInputNodeDefinition(),
    new TransformNodeDefinition(),
    new TextTemplateNodeDefinition(),
    new TextOutputNodeDefinition(),
    new ImageLoaderNodeDefinition(),
    new ImageSourceNodeDefinition(),
    new OkEmitterNodeDefinition(),
    // in-process tool node (agent-tools builtins; no optional provider SDK)
    new ToolNodeDefinition(),
    // utility text/data nodes (tier-1)
    new StringToNumberNodeDefinition(),
    new NumberToStringNodeDefinition(),
    new TextJoinNodeDefinition(),
    new TextSplitNodeDefinition(),
    new TextReplaceNodeDefinition(),
    new TextLengthNodeDefinition(),
    new TextUpperNodeDefinition(),
    new TextLowerNodeDefinition(),
    new TextTrimNodeDefinition(),
    new JsonExtractNodeDefinition(),
    new ConditionalTextNodeDefinition(),
    new TextCountLinesNodeDefinition(),
    new TextRepeatNodeDefinition(),
    new TextSliceNodeDefinition(),
  ];
}

interface IOptionalNodeLoader {
  readonly modulePath: string;
  readonly factories: ReadonlyArray<(mod: Record<string, unknown>) => IDagNodeDefinition>;
}

/**
 * Loads the default node registry, including LLM nodes whose construction may
 * depend on optional provider SDK peer dependencies. Each LLM node is loaded
 * dynamically; if the corresponding SDK is not installed, that node is
 * silently skipped instead of failing the entire registry build.
 */
export async function createDefaultNodeRegistry(): Promise<IDagNodeDefinition[]> {
  const nodes: IDagNodeDefinition[] = [...createDefaultNodeRegistrySync()];

  const optionalLoaders: ReadonlyArray<IOptionalNodeLoader> = [
    {
      modulePath: '@robota-sdk/dag-node-llm-text-anthropic',
      factories: [
        (mod) => new (mod.LlmTextAnthropicNodeDefinition as new () => IDagNodeDefinition)(),
      ],
    },
    {
      modulePath: '@robota-sdk/dag-node-llm-text-openai',
      factories: [(mod) => new (mod.LlmTextOpenAiNodeDefinition as new () => IDagNodeDefinition)()],
    },
    {
      modulePath: '@robota-sdk/dag-node-llm-text-gemini',
      factories: [(mod) => new (mod.LlmTextGeminiNodeDefinition as new () => IDagNodeDefinition)()],
    },
    {
      modulePath: '@robota-sdk/dag-node-llm-text-deepseek',
      factories: [
        (mod) => new (mod.LlmTextDeepSeekNodeDefinition as new () => IDagNodeDefinition)(),
      ],
    },
    {
      modulePath: '@robota-sdk/dag-node-llm-text-qwen',
      factories: [(mod) => new (mod.LlmTextQwenNodeDefinition as new () => IDagNodeDefinition)()],
    },
    {
      modulePath: '@robota-sdk/dag-node-gemini-image-edit',
      factories: [
        (mod) => new (mod.GeminiImageEditNodeDefinition as new () => IDagNodeDefinition)(),
        (mod) => new (mod.GeminiImageComposeNodeDefinition as new () => IDagNodeDefinition)(),
      ],
    },
    {
      modulePath: '@robota-sdk/dag-node-text-to-image',
      factories: [(mod) => new (mod.TextToImageNodeDefinition as new () => IDagNodeDefinition)()],
    },
    {
      modulePath: '@robota-sdk/dag-node-seedance-video',
      factories: [(mod) => new (mod.SeedanceVideoNodeDefinition as new () => IDagNodeDefinition)()],
    },
    {
      modulePath: '@robota-sdk/dag-node-skill',
      factories: [(mod) => new (mod.SkillNodeDefinition as new () => IDagNodeDefinition)()],
    },
  ];

  const loadedGroups = await Promise.all(optionalLoaders.map(loadOptionalNodes));
  for (const loaded of loadedGroups) {
    nodes.push(...loaded);
  }

  return nodes;
}

async function loadOptionalNodes(loader: IOptionalNodeLoader): Promise<IDagNodeDefinition[]> {
  const mod = await tryImport(loader.modulePath);
  if (!mod) return [];
  const out: IDagNodeDefinition[] = [];
  for (const factory of loader.factories) {
    const node = tryConstruct(factory, mod);
    if (node) out.push(node);
  }
  return out;
}

async function tryImport(modulePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- optional peer SDK; truly conditional
    return (await import(modulePath)) as Record<string, unknown>;
  } catch (_err) {
    // allow-fallback: optional peer dependency missing → skip node, do not crash registry
    return undefined;
  }
}

function tryConstruct(
  factory: (mod: Record<string, unknown>) => IDagNodeDefinition,
  mod: Record<string, unknown>,
): IDagNodeDefinition | undefined {
  try {
    return factory(mod);
  } catch (_err) {
    // allow-fallback: provider node construct failure (SDK absent) → skip silently
    return undefined;
  }
}
