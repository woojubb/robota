import { createHash } from 'node:crypto';
import { createSkillCommand, decodeFrontmatter } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';
import { McpSkillActivationError } from './mcp-skill-registry.js';
import type { IMcpActiveSkill, IMcpSkillMetadata, McpSkillRegistry } from './mcp-skill-registry.js';

export function mcpSkillInvocationName(namespace: string): string {
  return `mcp-skill-${createHash('sha256').update(namespace).digest('hex')}`;
}

function project(metadata: IMcpSkillMetadata, registry: McpSkillRegistry) {
  const { serverId, entry, namespace, fingerprint } = metadata;
  const invocationName = mcpSkillInvocationName(namespace);
  const decoded = decodeFrontmatter({
    source: namespace,
    content: `---\n${JSON.stringify(entry.frontmatter)}\n---\n`,
    profile: 'skill',
  });
  if (!decoded.ok)
    return {
      unavailableReason: decoded.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.field ?? 'frontmatter'}`)
        .join('; '),
    };
  const command: ICommand = {
    ...createSkillCommand(decoded.metadata, '', invocationName, undefined),
    name: invocationName,
    source: 'host-skill',
    description: `${entry.frontmatter.name} (${serverId}): ${entry.frontmatter.description}`,
    skillContentLoader: {
      acquire: async (signal) => {
        let activation: IMcpActiveSkill | undefined;
        try {
          const active = await registry.activate(serverId, entry.uri, signal);
          activation = active;
          if (active.namespace !== namespace || active.fingerprint !== fingerprint)
            throw new McpSkillActivationError('content-changed');
          return {
            content: active.content,
            ...(active.entry.resources === 'dynamic'
              ? {}
              : {
                  resources: {
                    manifest: active.entry.resources,
                    read: (uri: string, signal?: AbortSignal) => active.read(uri, signal),
                  },
                }),
            validate: () => active.validate(),
            close: () => active.close(),
          };
        } catch (error) {
          activation?.close();
          if (error instanceof McpSkillActivationError && error.reason === 'approval-required')
            throw new Error(
              `Skill content consent is required. Ask the local user to run /mcp skill-inspect ${JSON.stringify([serverId, entry.uri])} and approve the reviewed fingerprint.`,
            );
          throw error;
        }
      },
    },
  };
  return { command, invocationName };
}

export function createMcpSkillCommandSource(registry: McpSkillRegistry): ICommandSource & {
  describe(metadata: IMcpSkillMetadata): { invocationName?: string; unavailableReason?: string };
} {
  return {
    name: 'mcp-skills',
    getCommands: () =>
      registry.listMetadata().flatMap((metadata) => {
        const result = project(metadata, registry);
        return result.command ? [result.command] : [];
      }),
    describe: (metadata) => {
      const { invocationName, unavailableReason } = project(metadata, registry);
      return {
        ...(invocationName ? { invocationName } : {}),
        ...(unavailableReason ? { unavailableReason } : {}),
      };
    },
  };
}
