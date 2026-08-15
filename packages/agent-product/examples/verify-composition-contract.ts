import { FunctionTool } from '@robota-sdk/agent-core';
import { mergeCapabilityPacks, type ICapabilityPack } from '@robota-sdk/agent-capability-pack';
import { assembleProduct } from '../src/index.js';

import type { IAgentDefinition, ICommandModule } from '@robota-sdk/agent-framework';

function commandModule(name: string): ICommandModule {
  return { name };
}

function tool(name: string): FunctionTool {
  return new FunctionTool(
    { name, description: name, parameters: { type: 'object', properties: {} } },
    async () => ({ success: true }),
  );
}

function subagent(name: string): IAgentDefinition {
  return { name, description: name, systemPrompt: name };
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main(): void {
  const base = [commandModule('base-collision')];
  const packs: ICapabilityPack[] = [
    {
      id: 'first',
      title: 'First Pack',
      description: 'Accepted metadata',
      commandModules: [commandModule('shared-command')],
      tools: [tool('SharedTool')],
      subagents: [subagent('SharedAgent')],
    },
    {
      id: 'collision-source',
      commandModules: [commandModule('base-collision'), commandModule('shared-command')],
      tools: [tool('SharedTool')],
      subagents: [subagent('SharedAgent')],
    },
    {
      id: 'first',
      title: 'Rejected Duplicate',
      commandModules: [commandModule('duplicate-command-must-not-land')],
      tools: [tool('DuplicateToolMustNotLand')],
      subagents: [subagent('DuplicateAgentMustNotLand')],
    },
    { id: 'first' },
    {
      id: 'following',
      title: 'Following Pack',
      commandModules: [commandModule('following-command')],
    },
  ];

  const merged = mergeCapabilityPacks(base, packs);
  const product = assembleProduct({
    id: 'scenario-product',
    providerDefinitions: [],
    baseCommandModules: base,
    packs,
  });

  const commandNames = product.commandModules.map((entry) => entry.name);
  const toolNames = product.tools.map((entry) => entry.getName());
  const subagentNames = product.subagents.map((entry) => entry.name);
  const rejectedPackCapabilitiesAbsent =
    !commandNames.includes('duplicate-command-must-not-land') &&
    !toolNames.includes('DuplicateToolMustNotLand') &&
    !subagentNames.includes('DuplicateAgentMustNotLand');
  const followingUniquePackMerged = commandNames.includes('following-command');
  const collisionPackIds = product.rejectedCapabilities.map((entry) => entry.packId);
  const expectedAcceptedPacks = [
    { id: 'first', title: 'First Pack', description: 'Accepted metadata' },
    { id: 'collision-source' },
    { id: 'following', title: 'Following Pack' },
  ];
  const expectedRejectedPacks = [
    { packId: 'first', reason: 'duplicate pack id' },
    { packId: 'first', reason: 'duplicate pack id' },
  ];
  const losslessProjection =
    JSON.stringify(product.acceptedPacks) === JSON.stringify(merged.acceptedPacks) &&
    JSON.stringify(product.rejectedPacks) === JSON.stringify(merged.rejectedPacks) &&
    JSON.stringify(product.rejectedCapabilities) === JSON.stringify(merged.rejected);

  assertCondition(rejectedPackCapabilitiesAbsent, 'duplicate pack contributed a capability');
  assertCondition(followingUniquePackMerged, 'following unique pack did not merge');
  assertCondition(
    JSON.stringify(product.acceptedPacks) === JSON.stringify(expectedAcceptedPacks),
    'accepted pack metadata or order changed',
  );
  assertCondition(
    JSON.stringify(product.rejectedPacks) === JSON.stringify(expectedRejectedPacks),
    'duplicate pack rejection count or order changed',
  );
  assertCondition(
    collisionPackIds.length === 4 &&
      collisionPackIds.every((packId) => packId === 'collision-source'),
    'capability collision provenance did not retain the rejected contributor pack id',
  );
  assertCondition(losslessProjection, 'assembled product dropped or changed pack merge results');

  process.stdout.write(
    `${JSON.stringify({
      acceptedPacks: product.acceptedPacks,
      rejectedPacks: product.rejectedPacks,
      rejectedCapabilities: product.rejectedCapabilities,
      commandNames,
      toolNames,
      subagentNames,
      rejectedPackCapabilitiesAbsent,
      followingUniquePackMerged,
      collisionPackIds,
      losslessProjection,
    })}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
