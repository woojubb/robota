import type { IDagNodeDefinition } from '@robota-sdk/dag-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { ISkillExecutionPort } from '@robota-sdk/agent-interface-transport';
import { createSkillExecutionPort } from '@robota-sdk/agent-framework';
import { LlmTextNodeDefinition } from '@robota-sdk/dag-node-llm-text';
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

/** Lazily loads the default provider-definition set. Kept dynamic so `dag-framework` gains NO static
 * provider-SDK dependency (ARCH-PROVIDER-003). Unlike the per-node optional loaders below, a failure here
 * is surfaced as a TYPED DIAGNOSTIC naming the missing package — the collapsed `llm-text` node is never
 * silently dropped, and explicit `providers` injection is the supported partial-install path. */
export type TProviderDefinitionLoader = () => Promise<readonly IProviderDefinition[]>;

const loadDefaultProviderDefinitions: TProviderDefinitionLoader = async () => {
  try {
    // eslint-disable-next-line no-restricted-syntax -- lazy default set; keeps dag-framework SDK-free
    const mod = (await import('@robota-sdk/agent-provider-defaults')) as {
      createDefaultProviderDefinitions: () => readonly IProviderDefinition[];
    };
    return mod.createDefaultProviderDefinitions();
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Failed to load the default LLM provider set for the llm-text node. A provider SDK package is ' +
        'likely not installed. Install @robota-sdk/agent-provider-defaults (and its provider SDKs), or ' +
        `pass createDagFramework({ providers: [...] }) explicitly. Cause: ${cause}`,
    );
  }
};

/**
 * Loads the default node registry. The collapsed provider-registry `llm-text` node
 * (`@robota-sdk/dag-node-llm-text`, which depends on `agent-core` only) is a STATIC import and is always
 * present; it is constructed with the injected `providers`, or — when none are given — a lazily-loaded
 * `createDefaultProviderDefinitions()` (see {@link loadDefaultProviderDefinitions} for the partial-install
 * diagnostic). The remaining media/skill nodes are still dynamically imported and silently skipped when their
 * optional SDK peer dependency is absent.
 */
export async function createDefaultNodeRegistry(
  providers?: readonly IProviderDefinition[],
  loadDefaults: TProviderDefinitionLoader = loadDefaultProviderDefinitions,
): Promise<IDagNodeDefinition[]> {
  const resolvedProviders = providers ?? (await loadDefaults());
  const nodes: IDagNodeDefinition[] = [
    ...createDefaultNodeRegistrySync(),
    new LlmTextNodeDefinition(resolvedProviders),
  ];

  const optionalLoaders: ReadonlyArray<IOptionalNodeLoader> = [
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
  ];

  const loadedGroups = await Promise.all([
    ...optionalLoaders.map(loadOptionalNodes),
    loadSkillNode(),
  ]);
  for (const loaded of loadedGroups) {
    nodes.push(...loaded);
  }

  return nodes;
}

/**
 * Bespoke loader for the `skill` node (ARCH-PROVIDER-005). Unlike the uniform optional loaders, the skill node
 * requires an injected `ISkillExecutionPort` whose concrete implementation is owned by
 * `@robota-sdk/agent-framework` (a DIFFERENT package). This aggregator builds the agent-framework-backed port
 * and injects it — moving the former `dag-node-skill → agent-framework` leaf coupling UP to the composition
 * root (ARL-11 skill-half).
 *
 * `createSkillExecutionPort` is a **static** import (agent-framework is a regular dependency of this
 * aggregator): a *dynamic* `import('@robota-sdk/agent-framework')` panics Rolldown when `agent-cli` bundles the
 * whole workspace (INFRA-028) because agent-framework is ALSO statically bundled — the mixed static+dynamic
 * import of one module leaves a symbol "not in any chunk". The `dag-node-skill` NODE stays a dynamic optional
 * import (as before), so the graceful-skip for a missing skill node is preserved.
 */
async function loadSkillNode(): Promise<IDagNodeDefinition[]> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- optional node package (skill node is optional)
    const skillMod = (await import('@robota-sdk/dag-node-skill')) as {
      SkillNodeDefinition: new (options: { skillPort: ISkillExecutionPort }) => IDagNodeDefinition;
    };
    return [new skillMod.SkillNodeDefinition({ skillPort: createSkillExecutionPort() })];
  } catch (_err) {
    // allow-fallback: the optional skill node package is absent → skip the skill node, keep the registry
    return [];
  }
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
