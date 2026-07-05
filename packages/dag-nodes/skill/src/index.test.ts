import { describe, it, expect } from 'vitest';
import type { INodeExecutionContext, INodeConfigObject, TPortPayload } from '@robota-sdk/dag-core';
import type { ICommand } from '@robota-sdk/agent-interface-transport';
import {
  SkillNodeDefinition,
  SkillNodeConfigSchema,
  createSkillNodeDefinition,
  type ISkillNodeDefinitionOptions,
} from './index.js';

const greet: ICommand = {
  name: 'greet',
  description: 'Greets the user',
  source: 'skill',
  skillContent: 'Say hello to $ARGUMENTS.',
};

const forkSkill: ICommand = {
  name: 'deep',
  description: 'deep',
  source: 'skill',
  context: 'fork',
  skillContent: 'x',
};

function makeNode(options?: ISkillNodeDefinitionOptions): SkillNodeDefinition {
  return new SkillNodeDefinition(options ?? { loadCommands: () => [greet, forkSkill] });
}

function makeContext(config: Record<string, unknown>): INodeExecutionContext {
  const node = makeNode();
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'skill-1',
      nodeType: 'skill',
      dependsOn: [],
      config: config as INodeConfigObject,
      inputs: [],
      outputs: [],
    },
    nodeManifest: {
      nodeType: 'skill',
      displayName: 'Skill',
      category: 'Integration',
      inputs: node.inputs,
      outputs: node.outputs,
      defaultInputPort: node.defaultInputPort,
      defaultOutputPort: node.defaultOutputPort,
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('SkillNodeDefinition metadata', () => {
  it('has correct nodeType/displayName/category and ports', () => {
    const node = makeNode();
    expect(node.nodeType).toBe('skill');
    expect(node.displayName).toBe('Skill');
    expect(node.category).toBe('Integration');
    expect(node.inputs.find((p) => p.key === 'args')?.required).toBe(false);
    expect(node.outputs.find((p) => p.key === 'prompt')).toBeDefined();
    expect(node.outputs.find((p) => p.key === 'mode')).toBeDefined();
    expect(node.defaultInputPort).toBe('args');
    expect(node.defaultOutputPort).toBe('prompt');
  });

  it('factory returns an instance', () => {
    expect(createSkillNodeDefinition()).toBeInstanceOf(SkillNodeDefinition);
  });
});

describe('SkillNodeConfigSchema', () => {
  it('applies defaults and requires skillName', () => {
    const parsed = SkillNodeConfigSchema.parse({ skillName: 'greet' });
    expect(parsed.args).toBe('');
    expect(parsed.baseCredits).toBe(0);
    expect(SkillNodeConfigSchema.safeParse({ skillName: '' }).success).toBe(false);
  });
});

describe('SkillNodeDefinition execution', () => {
  it('resolves a skill and emits the prompt (config args)', async () => {
    const node = makeNode();
    const result = await node.taskHandler.execute(
      {},
      makeContext({ skillName: 'greet', args: 'World' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('inject');
      expect(String(result.value.prompt)).toContain('Say hello to World.');
    }
  });

  it('lets the args input port override config args', async () => {
    const node = makeNode();
    const input: TPortPayload = { args: 'FromInput' };
    const result = await node.taskHandler.execute(
      input,
      makeContext({ skillName: 'greet', args: 'FromConfig' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(String(result.value.prompt)).toContain('Say hello to FromInput.');
  });

  it('propagates skill-not-found', async () => {
    const node = makeNode();
    const result = await node.taskHandler.execute({}, makeContext({ skillName: 'nope' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_SKILL_NOT_FOUND');
  });

  it('propagates fork-unsupported', async () => {
    const node = makeNode();
    const result = await node.taskHandler.execute({}, makeContext({ skillName: 'deep' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_SKILL_FORK_UNSUPPORTED');
  });
});
