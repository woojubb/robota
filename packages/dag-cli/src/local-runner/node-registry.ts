import type { IDagNodeDefinition, IWorkspaceLayout } from '@robota-sdk/dag-core';
import { findMediaProviderDefinition } from '@robota-sdk/agent-core';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import { LlmTextNodeDefinition } from '@robota-sdk/dag-node-llm-text';
import {
  createDefaultMediaProviderDefinitions,
  createDefaultProviderDefinitions,
} from '@robota-sdk/agent-builtin-providers';
import {
  GeminiImageEditNodeDefinition,
  GeminiImageComposeNodeDefinition,
} from '@robota-sdk/dag-node-gemini-image-edit';
import { McpToolNodeDefinition } from '@robota-sdk/dag-node-mcp-tool';
import { HttpRequestNodeDefinition } from '@robota-sdk/dag-node-http-request';
import { FileReadNodeDefinition } from '@robota-sdk/dag-node-file-read';
import { FileWriteNodeDefinition } from '@robota-sdk/dag-node-file-write';
import { loadLocalNodeDefinitions } from './local-node-loader.js';

export function createCliNodeRegistry(): IDagNodeDefinition[] {
  const providers = createDefaultProviderDefinitions();
  const mediaProviders = createDefaultMediaProviderDefinitions();
  const imageProviderDefinition = findMediaProviderDefinition(mediaProviders, 'gemini-image');
  return [
    ...createDefaultNodeRegistrySync(),
    new LlmTextNodeDefinition(providers),
    new GeminiImageEditNodeDefinition({ imageProviderDefinition }),
    new GeminiImageComposeNodeDefinition({ imageProviderDefinition }),
    new McpToolNodeDefinition(),
    new HttpRequestNodeDefinition(),
    new FileReadNodeDefinition(),
    new FileWriteNodeDefinition(),
  ];
}

/**
 * Returns the built-in node registry merged with any local `.dag.node.js` files
 * found under `projectDir`. Local nodes override built-ins with the same nodeType.
 */
export async function createCliNodeRegistryWithLocalNodes(
  projectDir: string,
  options?: { verbose?: boolean; workspace?: IWorkspaceLayout },
): Promise<IDagNodeDefinition[]> {
  const [builtIn, local] = await Promise.all([
    Promise.resolve(createCliNodeRegistry()),
    loadLocalNodeDefinitions({
      projectDir,
      verbose: options?.verbose,
      ...(options?.workspace ? { workspace: options.workspace } : {}),
    }),
  ]);

  if (local.length === 0) return builtIn;

  const localTypes = new Set(local.map((n) => n.nodeType));
  const conflicts = builtIn.filter((n) => localTypes.has(n.nodeType));
  if (conflicts.length > 0) {
    process.stderr.write(
      `[local-node-loader] overriding built-in nodes: ${conflicts.map((n) => n.nodeType).join(', ')}\n`,
    );
  }

  return [...builtIn.filter((n) => !localTypes.has(n.nodeType)), ...local];
}
