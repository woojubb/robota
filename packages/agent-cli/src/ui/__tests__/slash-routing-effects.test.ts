import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { CommandRegistry } from '@robota-sdk/agent-sdk';
import type { ICommandInteraction, InteractiveSession } from '@robota-sdk/agent-sdk';
import { TuiStateManager } from '../tui-state-manager.js';
import { applySystemCommandResult } from '../hooks/useSlashRouting.js';
import { CommandEffectQueue } from '../hooks/command-effect-queue.js';

describe('applySystemCommandResult', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createRegistry(): CommandRegistry {
    return new CommandRegistry();
  }

  function legacyCommandField(suffix: 'Interaction' | 'Effects'): string {
    return `_pendingCommand${suffix}`;
  }

  it('stores statusline settings patch as a CLI side effect', () => {
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession;
    const manager = new TuiStateManager();
    const queue = new CommandEffectQueue();

    applySystemCommandResult(
      {
        success: true,
        message: 'Status line disabled.',
        effects: [{ type: 'statusline-settings-patch', patch: { enabled: false } }],
      },
      session,
      createRegistry(),
      manager,
      queue,
    );

    expect(queue.drain()).toEqual({
      type: 'effects',
      effects: [{ type: 'statusline-settings-patch', patch: { enabled: false } }],
    });
    expect(Object.hasOwn(session, legacyCommandField('Effects'))).toBe(false);
  });

  it('stores generic command interactions without interpreting command-specific data', () => {
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession;
    const manager = new TuiStateManager();
    const queue = new CommandEffectQueue();
    const interaction: ICommandInteraction = {
      prompt: {
        kind: 'choice',
        title: 'Change provider?',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      },
      submit: () => ({ success: true, message: 'done' }),
    };

    applySystemCommandResult(
      {
        success: true,
        message: 'Switch provider?',
        interaction,
      },
      session,
      createRegistry(),
      manager,
      queue,
    );

    expect(queue.drain()).toEqual({ type: 'interaction', interaction });
    expect(Object.hasOwn(session, legacyCommandField('Interaction'))).toBe(false);
  });

  it('stores host command side effects', () => {
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession;
    const manager = new TuiStateManager();
    const queue = new CommandEffectQueue();

    applySystemCommandResult(
      {
        success: true,
        message: 'Opening plugin manager...',
        effects: [{ type: 'plugin-tui-requested' }],
      },
      session,
      createRegistry(),
      manager,
      queue,
    );

    expect(queue.drain()).toEqual({
      type: 'effects',
      effects: [{ type: 'plugin-tui-requested' }],
    });
    expect(Object.hasOwn(session, legacyCommandField('Effects'))).toBe(false);
  });

  it('applies conversation history clearing immediately before adding the command result', () => {
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession;
    const manager = new TuiStateManager();
    const queue = new CommandEffectQueue();
    manager.addEntry({
      id: 'old',
      timestamp: new Date('2026-05-03T00:00:00.000Z'),
      category: 'chat',
      type: 'user',
      data: { role: 'user', content: 'old message' },
    });

    applySystemCommandResult(
      {
        success: true,
        message: 'Conversation cleared.',
        effects: [{ type: 'conversation-history-cleared' }],
      },
      session,
      createRegistry(),
      manager,
      queue,
    );

    expect(manager.history).toHaveLength(1);
    expect(manager.history[0]?.type).toBe('system');
    expect(manager.history[0]?.data).toMatchObject({ content: 'Conversation cleared.' });
    expect(queue.drain()).toBeUndefined();
    expect(Object.hasOwn(session, legacyCommandField('Effects'))).toBe(false);
  });

  it('reloads plugin command source immediately when requested', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-plugin-reload-'));
    const pluginDir = join(
      home,
      '.robota',
      'plugins',
      'cache',
      'community',
      'fresh-plugin',
      '1.0.0',
    );
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'skills', 'fresh-skill'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'fresh-plugin',
        version: '1.0.0',
        description: 'Fresh plugin',
        features: { skills: true },
      }),
      'utf8',
    );
    writeFileSync(
      join(pluginDir, 'skills', 'fresh-skill', 'SKILL.md'),
      '---\ndescription: Fresh skill\n---\n# Fresh Skill\n',
      'utf8',
    );
    vi.stubEnv('HOME', home);
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession;
    const registry = createRegistry();
    const queue = new CommandEffectQueue();
    registry.addSource({
      name: 'plugin',
      getCommands: () => [{ name: 'stale-skill', description: 'Stale', source: 'plugin' }],
    });
    const manager = new TuiStateManager();

    applySystemCommandResult(
      {
        success: true,
        message: 'Reloaded 1 plugin resource.',
        effects: [{ type: 'plugin-registry-reload-requested' }],
      },
      session,
      registry,
      manager,
      queue,
    );

    expect(registry.getCommands().map((command) => command.name)).toEqual(['fresh-skill']);
    expect(queue.drain()).toBeUndefined();
    expect(Object.hasOwn(session, legacyCommandField('Effects'))).toBe(false);
  });
});
