import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { INodeExecutionContext, INodeConfigObject, TPortPayload } from '@robota-sdk/dag-core';
import type { ICommand, ISkillExecutionPort } from '@robota-sdk/agent-interface-transport';
import { SkillNodeDefinition, SkillNodeConfigSchema } from './index.js';

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

/** Stub skill-execution port — the node is a leaf that depends on the port contract (ARCH-PROVIDER-005). */
const stubPort: ISkillExecutionPort = {
  loadCommands: () => [greet, forkSkill],
  resolveSkill: async (skill, args) => ({
    mode: 'inject',
    prompt: `resolved ${skill.name}: ${args}`,
  }),
};

function makeNode(port: ISkillExecutionPort = stubPort): SkillNodeDefinition {
  return new SkillNodeDefinition({ skillPort: port });
}

function makeContext(
  config: Record<string, unknown>,
  executionRoot = process.cwd(),
): INodeExecutionContext {
  const node = makeNode();
  return {
    executionRoot,
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
  it('refuses an authored cwd that widens outside the trusted execution root', async () => {
    const node = makeNode();
    const result = await node.taskHandler.execute(
      {},
      makeContext({ skillName: 'greet', cwd: '/' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_SKILL_CWD_OUTSIDE_ROOT');
  });

  it('refuses symlink widening while allowing an internal discovery-root narrowing', async () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'arch010-skill-root-')));
    const project = join(fixture, 'project');
    const outside = join(fixture, 'outside');
    const inside = join(project, 'inside');
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(project, 'escape'), 'dir');

    let observedCwd: string | undefined;
    const node = makeNode({
      ...stubPort,
      loadCommands: (cwd) => {
        observedCwd = cwd;
        return [greet, forkSkill];
      },
    });

    try {
      const escaped = await node.taskHandler.execute(
        {},
        makeContext({ skillName: 'greet', cwd: 'escape' }, project),
      );
      expect(escaped.ok).toBe(false);
      if (!escaped.ok) {
        expect(escaped.error.code).toBe('DAG_VALIDATION_SKILL_CWD_OUTSIDE_ROOT');
      }

      const narrowed = await node.taskHandler.execute(
        {},
        makeContext({ skillName: 'greet', cwd: 'inside' }, project),
      );
      expect(narrowed.ok).toBe(true);
      expect(observedCwd).toBe(inside);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('resolves a skill and emits the prompt (config args)', async () => {
    const node = makeNode();
    const result = await node.taskHandler.execute(
      {},
      makeContext({ skillName: 'greet', args: 'World' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('inject');
      expect(String(result.value.prompt)).toContain('resolved greet: World');
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
    if (result.ok) expect(String(result.value.prompt)).toContain('resolved greet: FromInput');
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
