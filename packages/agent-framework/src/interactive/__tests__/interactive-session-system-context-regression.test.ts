/**
 * Regression tests for system context file tracking in InteractiveSession.
 *
 * Verifies the exact bug that was fixed:
 * - Bug: AGENTS.md / CLAUDE.md appeared twice in /context list after a prompt was submitted
 *   (once as [system, active] and once as [manual, active])
 * - Root cause: getContextReferences() used listContextReferences() which included system refs.
 *   preparePromptInput resolved them as 'manual' and recordContextReferenceUsage added duplicates.
 * - Fix: getContextReferences() now calls listInjectionContextReferences() which excludes system
 *   refs, so system files are never re-added as manual via the prompt execution path.
 *
 * These tests use the standard InteractiveSession initialization path (not injected session)
 * so they exercise the full init → submit → listContextReferences flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module-level mocks (must appear before any imports) ---

const AGENTS_CONTENT = '# Agent Rules\nFollow these rules.\n';
const CLAUDE_CONTENT = '# Claude Config\nBe helpful.\n';

const mockAgentsEntry = {
  filePath: '/workspace/AGENTS.md',
  content: AGENTS_CONTENT,
  contentHash: 'agents-hash',
};
const mockClaudeEntry = {
  filePath: '/workspace/CLAUDE.md',
  content: CLAUDE_CONTENT,
  contentHash: 'claude-hash',
};

const mockLoadContext = vi.fn().mockResolvedValue({
  agentsMd: AGENTS_CONTENT,
  projectNotesMd: CLAUDE_CONTENT,
  agentsFileEntries: [mockAgentsEntry],
  projectNotesFileEntries: [mockClaudeEntry],
});
vi.mock('../../context/context-loader.js', () => ({
  loadContext: mockLoadContext,
}));

vi.mock('../../context/project-detector.js', () => ({
  detectProject: vi.fn().mockResolvedValue({ type: 'unknown', language: 'unknown' }),
}));

vi.mock('../../config/config-loader.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    defaultTrustLevel: 'moderate',
    provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
    permissions: { allow: [], deny: [] },
    language: 'en',
    env: {},
  }),
}));

vi.mock('../../plugins/index.js', () => ({
  BundlePluginLoader: vi.fn().mockImplementation(() => ({
    loadPluginsSync: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@robota-sdk/agent-session', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-session');
  return {
    ...actual,
    Session: vi.fn().mockImplementation(() => ({
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getEventService: vi.fn().mockReturnValue({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
      run: vi.fn().mockResolvedValue('mock response'),
      abort: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
      getContextState: vi.fn().mockReturnValue({
        usedTokens: 5000,
        maxTokens: 200000,
        usedPercentage: 2.5,
        remainingPercentage: 97.5,
      }),
      getPermissionMode: vi.fn().mockReturnValue('default'),
      setPermissionMode: vi.fn(),
      getSystemMessage: vi.fn().mockReturnValue('system prompt'),
      getToolSchemas: vi.fn().mockReturnValue([]),
      getMessageCount: vi.fn().mockReturnValue(0),
      getSessionAllowedTools: vi.fn().mockReturnValue([]),
      compact: vi.fn(),
    })),
    FileSessionLogger: vi.fn().mockImplementation(() => ({})),
  };
});

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue('mock AI response'),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
    })),
    runHooks: vi.fn().mockResolvedValue({ blocked: false }),
  };
});

// --- Test helpers ---

function createMockProvider() {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({
      role: 'assistant',
      content: 'mock response',
      timestamp: new Date(),
    }),
  } as never;
}

// --- Tests ---

describe('InteractiveSession — system context file regression', () => {
  beforeEach(() => {
    mockLoadContext.mockClear();
  });

  it('AGENTS.md and CLAUDE.md appear as system refs in listContextReferences after first prompt', async () => {
    const { InteractiveSession } = await import('../interactive-session.js');

    const session = new InteractiveSession({
      cwd: '/workspace',
      provider: createMockProvider(),
    });

    // submit() triggers initializeAsync internally before executing the prompt
    await session.submit('Hello');

    const refs = session.listContextReferences();
    const agentRefs = refs.filter((r) => r.relativePath === 'AGENTS.md');
    const claudeRefs = refs.filter((r) => r.relativePath === 'CLAUDE.md');

    expect(agentRefs).toHaveLength(1);
    expect(agentRefs[0]?.loadType).toBe('system');
    expect(claudeRefs).toHaveLength(1);
    expect(claudeRefs[0]?.loadType).toBe('system');
  });

  it('regression: no duplicate entries after submitting a prompt', async () => {
    // This is the exact bug: after one prompt, AGENTS.md appeared twice —
    // once as [system, active] and once as [manual, active].
    const { InteractiveSession } = await import('../interactive-session.js');

    const session = new InteractiveSession({
      cwd: '/workspace',
      provider: createMockProvider(),
    });

    await session.submit('Hello');

    const refs = session.listContextReferences();

    // AGENTS.md must appear exactly once
    const agentRefs = refs.filter((r) => r.relativePath === 'AGENTS.md');
    expect(agentRefs).toHaveLength(1);
    expect(agentRefs[0]?.loadType).toBe('system');

    // CLAUDE.md must appear exactly once
    const claudeRefs = refs.filter((r) => r.relativePath === 'CLAUDE.md');
    expect(claudeRefs).toHaveLength(1);
    expect(claudeRefs[0]?.loadType).toBe('system');

    // No manual duplicates
    const manualRefs = refs.filter((r) => r.loadType === 'manual');
    expect(manualRefs).toHaveLength(0);
  });

  it('regression: no duplicates after multiple prompt submissions', async () => {
    const { InteractiveSession } = await import('../interactive-session.js');

    const session = new InteractiveSession({
      cwd: '/workspace',
      provider: createMockProvider(),
    });

    await session.submit('First prompt');
    await session.submit('Second prompt');
    await session.submit('Third prompt');

    const refs = session.listContextReferences();

    expect(refs.filter((r) => r.relativePath === 'AGENTS.md')).toHaveLength(1);
    expect(refs.filter((r) => r.relativePath === 'CLAUDE.md')).toHaveLength(1);
    expect(refs.filter((r) => r.loadType === 'manual')).toHaveLength(0);
  });
});
