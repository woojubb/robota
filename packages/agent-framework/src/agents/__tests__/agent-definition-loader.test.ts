import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { AgentDefinitionLoader as FrameworkAgentDefinitionLoader } from '../agent-definition-loader.js';
import { BUILT_IN_AGENTS } from '../built-in-agents.js';
import { FrontmatterDecodeError } from '../../frontmatter/frontmatter-error.js';
import { createNodeHostContributionSourcesFixture } from '../../testing/contribution-source-fixture.js';

const FIXTURE_AGENT_ROOTS = [
  join('.robota', 'agents'),
  join('.agents', 'agents'),
  join('.claude', 'agents'),
];

class AgentDefinitionLoader extends FrameworkAgentDefinitionLoader {
  constructor(
    sources: ConstructorParameters<typeof FrameworkAgentDefinitionLoader>[0],
    builtInAgents?: ConstructorParameters<typeof FrameworkAgentDefinitionLoader>[1],
  ) {
    super(sources, builtInAgents, FIXTURE_AGENT_ROOTS);
  }
}

function createTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'agent-loader-test-')));
}

function writeAgentFile(dir: string, filename: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, 'utf-8');
}

function captureDecodeError(action: () => unknown): FrontmatterDecodeError {
  try {
    action();
  } catch (error) {
    if (error instanceof FrontmatterDecodeError) return error;
    throw error;
  }
  throw new Error('expected frontmatter decoding to fail');
}

describe('AgentDefinitionLoader', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = createTempDir();
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('discovers only the agent roots supplied by the host', () => {
    const cwd = makeTempDir();
    writeAgentFile(join(cwd, '.custom', 'agents'), 'selected.md', 'Selected agent');
    writeAgentFile(join(cwd, '.claude', 'agents'), 'ignored.md', 'Ignored agent');

    const sources = createNodeHostContributionSourcesFixture(cwd);
    const neutralLoader = new FrameworkAgentDefinitionLoader(sources, [], []);
    expect(neutralLoader.loadAll()).toEqual([]);

    const hostLoader = new FrameworkAgentDefinitionLoader(sources, [], [join('.custom', 'agents')]);
    expect(hostLoader.loadAll().map((agent) => agent.name)).toEqual(['selected']);
  });

  it('should parse agent markdown with frontmatter', () => {
    const cwd = makeTempDir();
    const agentsDir = join(cwd, '.claude', 'agents');
    writeAgentFile(
      agentsDir,
      'reviewer.md',
      `---
name: security-reviewer
description: Reviews code for security vulnerabilities
model: sonnet
maxTurns: 20
disallowedTools: Write, Edit, Bash
---

You are a security code reviewer. Analyze the provided code for vulnerabilities.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const agent = loader.getAgent('security-reviewer');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('security-reviewer');
    expect(agent!.description).toBe('Reviews code for security vulnerabilities');
    expect(agent!.model).toBe('sonnet');
    expect(agent!.maxTurns).toBe(20);
    expect(agent!.disallowedTools).toEqual(['Write', 'Edit', 'Bash']);
    expect(agent!.systemPrompt).toBe(
      'You are a security code reviewer. Analyze the provided code for vulnerabilities.',
    );
  });

  it('should use filename as name fallback', () => {
    const cwd = makeTempDir();
    const agentsDir = join(cwd, '.claude', 'agents');
    writeAgentFile(
      agentsDir,
      'my-agent.md',
      `---
description: An agent without an explicit name
---

System prompt body here.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const agent = loader.getAgent('my-agent');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('my-agent');
    expect(agent!.description).toBe('An agent without an explicit name');
  });

  it('should load from Robota and Claude-compatible project/user agent paths', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();

    writeAgentFile(
      join(cwd, '.robota', 'agents'),
      'robota-project-agent.md',
      `---
name: robota-project-agent
description: Robota project-level agent
---

Robota project agent prompt.`,
    );

    writeAgentFile(
      join(cwd, '.agents', 'agents'),
      'agents-project-agent.md',
      `---
name: agents-project-agent
description: Agents project-level agent
---

Agents project agent prompt.`,
    );

    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'claude-project-agent.md',
      `---
name: claude-project-agent
description: Claude project-level agent
---

Claude project agent prompt.`,
    );

    writeAgentFile(
      join(home, '.robota', 'agents'),
      'robota-user-agent.md',
      `---
name: robota-user-agent
description: Robota user-level agent
---

Robota user agent prompt.`,
    );

    writeAgentFile(
      join(home, '.claude', 'agents'),
      'claude-user-agent.md',
      `---
name: claude-user-agent
description: Claude user-level agent
---

Claude user agent prompt.`,
    );

    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd, home));
    const all = loader.loadAll();
    const names = all.map((a) => a.name);

    expect(names).toContain('robota-project-agent');
    expect(names).toContain('agents-project-agent');
    expect(names).toContain('claude-project-agent');
    expect(names).toContain('robota-user-agent');
    expect(names).toContain('claude-user-agent');
  });

  it('should prioritize project Robota agents over project Claude and user agents', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();

    writeAgentFile(
      join(cwd, '.robota', 'agents'),
      'shared.md',
      `---
name: shared
description: Robota project version
---

Robota project prompt.`,
    );

    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'shared.md',
      `---
name: shared
description: Claude project version
---

Claude project prompt.`,
    );

    writeAgentFile(
      join(home, '.robota', 'agents'),
      'shared.md',
      `---
name: shared
description: User version
---

User prompt.`,
    );

    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd, home));
    const agent = loader.getAgent('shared');

    expect(agent).toBeDefined();
    expect(agent!.description).toBe('Robota project version');
  });

  it('should merge with built-in agents', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();

    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'custom.md',
      `---
name: custom
description: A custom agent
---

Custom prompt.`,
    );

    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd, home));
    const all = loader.loadAll();
    const names = all.map((a) => a.name);

    // Should contain all built-in agents
    for (const builtIn of BUILT_IN_AGENTS) {
      expect(names).toContain(builtIn.name);
    }
    // Plus the custom one
    expect(names).toContain('custom');
  });

  it('should override built-in with custom of same name', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();

    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'explore.md',
      `---
name: Explore
description: My custom Explore agent
model: opus
---

Custom explore prompt.`,
    );

    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd, home));
    const agent = loader.getAgent('Explore');

    expect(agent).toBeDefined();
    expect(agent!.description).toBe('My custom Explore agent');
    expect(agent!.model).toBe('opus');
    expect(agent!.systemPrompt).toBe('Custom explore prompt.');
  });

  it('should parse comma-separated tools fields', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'tools-test.md',
      `---
name: tools-test
description: Agent with tools
tools: Read, Grep, Glob
disallowedTools: Bash, Write
---

Prompt.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const agent = loader.getAgent('tools-test');

    expect(agent).toBeDefined();
    expect(agent!.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(agent!.disallowedTools).toEqual(['Bash', 'Write']);
  });

  it('should parse whitespace-separated tools fields', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'tools-space-test.md',
      `---
name: tools-space-test
description: Agent with space separated tools
tools: Read Grep Glob
disallowedTools: Bash Write
---

Prompt.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const agent = loader.getAgent('tools-space-test');

    expect(agent).toBeDefined();
    expect(agent!.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(agent!.disallowedTools).toEqual(['Bash', 'Write']);
  });

  it('should handle missing agents directories gracefully', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();
    // No .claude/agents/ or ~/.robota/agents/ dirs created

    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd, home));
    const all = loader.loadAll();

    // Should still return built-in agents
    expect(all.length).toBe(BUILT_IN_AGENTS.length);
    for (const builtIn of BUILT_IN_AGENTS) {
      expect(all.map((a) => a.name)).toContain(builtIn.name);
    }
  });

  it('should ignore non-.md files in agents directory', () => {
    const cwd = makeTempDir();
    const agentsDir = join(cwd, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'notes.txt'), 'not an agent', 'utf-8');
    writeAgentFile(
      agentsDir,
      'real-agent.md',
      `---
name: real-agent
description: A real agent
---

Prompt.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const all = loader.loadAll();
    const customNames = all.filter((a) => !BUILT_IN_AGENTS.some((b) => b.name === a.name));
    expect(customNames).toHaveLength(1);
    expect(customNames[0]!.name).toBe('real-agent');
  });

  it('should handle file without frontmatter', () => {
    const cwd = makeTempDir();
    const prompt = '\n  Just a plain system prompt with no frontmatter.  \n';
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'bare.md',
      prompt,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const agent = loader.getAgent('bare');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('bare');
    expect(agent!.description).toBe('');
    expect(agent!.systemPrompt).toBe(prompt);
  });

  it('rejects unclosed frontmatter with the source file in its diagnostic', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'broken.md',
      `---
name: broken-agent
description: This frontmatter is never closed

Some body content here.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    expect(() => loader.getAgent('broken')).toThrow(/broken\.md.*unterminated/i);
  });

  it('rejects a non-mapping frontmatter document with a file diagnostic', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'empty-fm.md',
      `---
just some random text
not key-value pairs at all
---

Actual body here.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const error = captureDecodeError(() => loader.getAgent('empty-fm'));
    expect(error.diagnostics[0]).toMatchObject({
      source: join(cwd, '.claude/agents/empty-fm.md'),
      code: 'root-type',
    });
  });

  it('rejects NaN maxTurns with a source-field diagnostic', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'nan-turns.md',
      `---
name: nan-turns
description: Agent with non-numeric maxTurns
maxTurns: not-a-number
---

Prompt.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const error = captureDecodeError(() => loader.getAgent('nan-turns'));
    expect(error.diagnostics[0]).toMatchObject({
      source: join(cwd, '.claude/agents/nan-turns.md'),
      field: 'maxTurns',
    });
  });

  it.each([
    ['project .robota', '.robota/agents', 'project'],
    ['project .agents', '.agents/agents', 'project'],
    ['project .claude', '.claude/agents', 'project'],
    ['user .robota', '.robota/agents', 'user'],
    ['user .agents', '.agents/agents', 'user'],
    ['user .claude', '.claude/agents', 'user'],
  ])('rejects numeric prefixes identically at the %s discovery root', (_label, relative, owner) => {
    const cwd = makeTempDir();
    const home = makeTempDir();
    const root = owner === 'project' ? cwd : home;
    writeAgentFile(join(root, relative), 'strict.md', '---\nmaxTurns: 20abc\n---\nPrompt.');

    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd, home));
    const error = captureDecodeError(() => loader.getAgent('strict'));
    const source = join(root, relative, 'strict.md');
    expect(error.message).toContain(`${source}:2:11 [invalid-type] maxTurns:`);
    expect(error.diagnostics[0]).toMatchObject({
      source,
      line: 2,
      column: 11,
      field: 'maxTurns',
      code: 'invalid-type',
    });
  });

  it('does not let a valid lower-priority collision hide invalid higher-priority metadata', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();
    writeAgentFile(
      join(cwd, '.robota', 'agents'),
      'shared.md',
      '---\nname: shared\nmaxTurns: 0\n---\nInvalid high-priority definition.',
    );
    writeAgentFile(
      join(home, '.robota', 'agents'),
      'shared.md',
      '---\nname: shared\nmaxTurns: 5\n---\nValid lower-priority definition.',
    );

    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd, home));
    const error = captureDecodeError(() => loader.getAgent('shared'));
    const source = join(cwd, '.robota/agents/shared.md');
    expect(error.message).toContain(`${source}:3:11 [invalid-value] maxTurns:`);
    expect(error.diagnostics[0]?.source).toBe(source);
  });

  it.each([
    ['NaN', '.nan', 'invalid-value'],
    ['zero', '0', 'invalid-value'],
    ['negative', '-2', 'invalid-value'],
    ['fractional', '2.5', 'invalid-value'],
    ['boolean', 'true', 'invalid-type'],
    ['null', 'null', 'invalid-type'],
    ['sequence', '[2]', 'invalid-type'],
  ])('rejects %s maxTurns with a structured field diagnostic', (_label, value, code) => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'bad-turns.md',
      `---\nmaxTurns: ${value}\n---\nPrompt.`,
    );
    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd));
    const error = captureDecodeError(() => loader.getAgent('bad-turns'));
    expect(error.diagnostics[0]).toMatchObject({
      source: join(cwd, '.claude/agents/bad-turns.md'),
      field: 'maxTurns',
      code,
    });
  });

  it('should decode YAML tool sequences without changing their order', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'sequence-tools.md',
      `---\nname: sequence-tools\ntools:\n  - Read\n  - Edit\ndisallowedTools:\n  - Bash\n---\nPrompt.`,
    );
    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd));
    const agent = loader.getAgent('sequence-tools');
    expect(agent?.tools).toEqual(['Read', 'Edit']);
    expect(agent?.disallowedTools).toEqual(['Bash']);
  });

  it('should handle empty tools list', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'empty-tools.md',
      `---
name: empty-tools
description: Agent with single-item tools
tools: Read
---

Prompt.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const agent = loader.getAgent('empty-tools');

    expect(agent).toBeDefined();
    expect(agent!.tools).toEqual(['Read']);
  });

  it('should ignore subdirectories in agents directory', () => {
    const cwd = makeTempDir();
    const agentsDir = join(cwd, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    // Create a subdirectory (should be ignored)
    mkdirSync(join(agentsDir, 'subdir'), { recursive: true });
    writeFileSync(
      join(agentsDir, 'subdir', 'nested.md'),
      `---
name: nested
description: Nested agent
---

Nested prompt.`,
      'utf-8',
    );

    writeAgentFile(
      agentsDir,
      'top-level.md',
      `---
name: top-level
description: Top-level agent
---

Top prompt.`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const all = loader.loadAll();
    const customNames = all.filter((a) => !BUILT_IN_AGENTS.some((b) => b.name === a.name));
    expect(customNames).toHaveLength(1);
    expect(customNames[0]!.name).toBe('top-level');
  });

  it('getAgent should return undefined for nonexistent name', () => {
    const cwd = makeTempDir();
    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    expect(loader.getAgent('does-not-exist')).toBeUndefined();
  });

  it('should handle duplicate names across project and user dirs (project wins)', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();

    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'dup.md',
      `---
name: duplicated
description: Project version
---

Project prompt.`,
    );

    writeAgentFile(
      join(home, '.robota', 'agents'),
      'dup.md',
      `---
name: duplicated
description: User version
---

User prompt.`,
    );

    const loader = new AgentDefinitionLoader(createNodeHostContributionSourcesFixture(cwd, home));
    const all = loader.loadAll();
    const dupAgents = all.filter((a) => a.name === 'duplicated');
    expect(dupAgents).toHaveLength(1);
    expect(dupAgents[0]!.description).toBe('Project version');
  });

  it('should handle empty .md file', () => {
    const cwd = makeTempDir();
    writeAgentFile(join(cwd, '.claude', 'agents'), 'empty.md', '');

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const agent = loader.getAgent('empty');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('empty');
    expect(agent!.systemPrompt).toBe('');
  });

  it('should handle frontmatter-only file (no body after ---)', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'fm-only.md',
      `---
name: fm-only
description: Frontmatter only agent
---`,
    );

    const loader = new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, makeTempDir()),
    );
    const agent = loader.getAgent('fm-only');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('fm-only');
    expect(agent!.description).toBe('Frontmatter only agent');
    expect(agent!.systemPrompt).toBe('');
  });
});
