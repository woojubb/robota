import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentDefinitionLoader } from '../agent-definition-loader.js';
import { BUILT_IN_AGENTS } from '../built-in-agents.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-loader-test-'));
}

function writeAgentFile(dir: string, filename: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, 'utf-8');
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

    const loader = new AgentDefinitionLoader(cwd);
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

    const loader = new AgentDefinitionLoader(cwd);
    const agent = loader.getAgent('my-agent');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('my-agent');
    expect(agent!.description).toBe('An agent without an explicit name');
  });

  it('should load from .claude/agents/ and ~/.robota/agents/', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();

    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'project-agent.md',
      `---
name: project-agent
description: Project-level agent
---

Project agent prompt.`,
    );

    writeAgentFile(
      join(home, '.robota', 'agents'),
      'user-agent.md',
      `---
name: user-agent
description: User-level agent
---

User agent prompt.`,
    );

    const loader = new AgentDefinitionLoader(cwd, home);
    const all = loader.loadAll();
    const names = all.map((a) => a.name);

    expect(names).toContain('project-agent');
    expect(names).toContain('user-agent');
  });

  it('should prioritize .claude/agents/ over ~/.robota/agents/', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();

    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'shared.md',
      `---
name: shared
description: Project version
---

Project prompt.`,
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

    const loader = new AgentDefinitionLoader(cwd, home);
    const agent = loader.getAgent('shared');

    expect(agent).toBeDefined();
    expect(agent!.description).toBe('Project version');
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

    const loader = new AgentDefinitionLoader(cwd, home);
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

    const loader = new AgentDefinitionLoader(cwd, home);
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

    const loader = new AgentDefinitionLoader(cwd);
    const agent = loader.getAgent('tools-test');

    expect(agent).toBeDefined();
    expect(agent!.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(agent!.disallowedTools).toEqual(['Bash', 'Write']);
  });

  it('should handle missing agents directories gracefully', () => {
    const cwd = makeTempDir();
    const home = makeTempDir();
    // No .claude/agents/ or ~/.robota/agents/ dirs created

    const loader = new AgentDefinitionLoader(cwd, home);
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

    const loader = new AgentDefinitionLoader(cwd);
    const all = loader.loadAll();
    const customNames = all.filter((a) => !BUILT_IN_AGENTS.some((b) => b.name === a.name));
    expect(customNames).toHaveLength(1);
    expect(customNames[0]!.name).toBe('real-agent');
  });

  it('should handle file without frontmatter', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'bare.md',
      'Just a plain system prompt with no frontmatter.',
    );

    const loader = new AgentDefinitionLoader(cwd);
    const agent = loader.getAgent('bare');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('bare');
    expect(agent!.description).toBe('');
    expect(agent!.systemPrompt).toBe('Just a plain system prompt with no frontmatter.');
  });

  it('should handle unclosed frontmatter (missing closing ---)', () => {
    const cwd = makeTempDir();
    writeAgentFile(
      join(cwd, '.claude', 'agents'),
      'broken.md',
      `---
name: broken-agent
description: This frontmatter is never closed

Some body content here.`,
    );

    const loader = new AgentDefinitionLoader(cwd);
    const agent = loader.getAgent('broken');

    // Unclosed frontmatter = no frontmatter parsed, entire content is body
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('broken'); // fallback to filename
    expect(agent!.description).toBe('');
    expect(agent!.systemPrompt).toContain('name: broken-agent');
  });

  it('should handle frontmatter with no valid key-value pairs', () => {
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

    const loader = new AgentDefinitionLoader(cwd);
    const agent = loader.getAgent('empty-fm');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('empty-fm'); // fallback to filename
    expect(agent!.description).toBe('');
    expect(agent!.systemPrompt).toBe('Actual body here.');
  });

  it('should handle NaN maxTurns gracefully', () => {
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

    const loader = new AgentDefinitionLoader(cwd);
    const agent = loader.getAgent('nan-turns');

    expect(agent).toBeDefined();
    // parseInt('not-a-number') returns NaN
    expect(agent!.maxTurns).toBeNaN();
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

    const loader = new AgentDefinitionLoader(cwd);
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

    const loader = new AgentDefinitionLoader(cwd);
    const all = loader.loadAll();
    const customNames = all.filter((a) => !BUILT_IN_AGENTS.some((b) => b.name === a.name));
    expect(customNames).toHaveLength(1);
    expect(customNames[0]!.name).toBe('top-level');
  });

  it('getAgent should return undefined for nonexistent name', () => {
    const cwd = makeTempDir();
    const loader = new AgentDefinitionLoader(cwd);
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

    const loader = new AgentDefinitionLoader(cwd, home);
    const all = loader.loadAll();
    const dupAgents = all.filter((a) => a.name === 'duplicated');
    expect(dupAgents).toHaveLength(1);
    expect(dupAgents[0]!.description).toBe('Project version');
  });

  it('should handle empty .md file', () => {
    const cwd = makeTempDir();
    writeAgentFile(join(cwd, '.claude', 'agents'), 'empty.md', '');

    const loader = new AgentDefinitionLoader(cwd);
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

    const loader = new AgentDefinitionLoader(cwd);
    const agent = loader.getAgent('fm-only');

    expect(agent).toBeDefined();
    expect(agent!.name).toBe('fm-only');
    expect(agent!.description).toBe('Frontmatter only agent');
    expect(agent!.systemPrompt).toBe('');
  });
});
