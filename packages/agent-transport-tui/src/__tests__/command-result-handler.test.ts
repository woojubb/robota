/**
 * CMD-004 Phase 2 Stage C: `applySystemCommandResult` is pure rendering. The only legacy effects
 * it still consumes are the two notification kinds (`conversation-history-cleared`,
 * `plugin-registry-reload-requested` — final carriers land in Stage E). Everything else —
 * host-executed actions (already applied + stripped by the session) and UI intents (delivered via
 * the `ui_intent` session event) — is ignored here by design.
 */

import { homedir } from 'node:os';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import {
  CommandRegistry,
  BundlePluginLoader,
  PluginCommandSource,
} from '@robota-sdk/agent-framework';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';
import { TuiStateManager } from '../tui-state-manager.js';
import { applySystemCommandResult } from '../hooks/command-result-handler.js';

const PLUGIN_SOURCE_NAME = 'plugin';

function reloadPluginCommandSource(registry: CommandRegistry): void {
  const pluginsDir = join(process.env.HOME ?? homedir(), '.robota', 'plugins');
  const loader = new BundlePluginLoader(pluginsDir);
  try {
    // allow-fallback: test helper — empty registry on load error is safe
    const plugins = loader.loadPluginsSync();
    if (plugins.length === 0) {
      registry.replaceSource(PLUGIN_SOURCE_NAME);
    } else {
      registry.replaceSource(PLUGIN_SOURCE_NAME, new PluginCommandSource(plugins));
    }
  } catch {
    // allow-fallback: test helper — empty registry on load error is safe
    registry.replaceSource(PLUGIN_SOURCE_NAME);
  }
}

describe('applySystemCommandResult', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createSession(): IInteractiveSession {
    return {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as IInteractiveSession;
  }

  it('renders the message and ignores residual UI-intent effects (delivered via ui_intent)', () => {
    const manager = new TuiStateManager();

    applySystemCommandResult(
      {
        success: true,
        message: 'Opening plugin manager...',
        effects: [{ type: 'plugin-tui-requested' }],
      },
      createSession(),
      new CommandRegistry(),
      manager,
    );

    // Pure rendering: the message lands in history; the legacy screen effect does nothing here.
    expect(manager.history).toHaveLength(1);
    expect(manager.history[0]?.data).toMatchObject({ content: 'Opening plugin manager...' });
  });

  it('ignores a residual statusline patch (host-applied; the TUI refreshes on result)', () => {
    const manager = new TuiStateManager();

    applySystemCommandResult(
      {
        success: true,
        message: 'Status line disabled.',
        effects: [{ type: 'statusline-settings-patch', patch: { enabled: false } }],
      },
      createSession(),
      new CommandRegistry(),
      manager,
    );

    expect(manager.history).toHaveLength(1);
    expect(manager.history[0]?.data).toMatchObject({ content: 'Status line disabled.' });
  });

  it('applies conversation history clearing immediately before adding the command result', () => {
    const manager = new TuiStateManager();
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
      createSession(),
      new CommandRegistry(),
      manager,
    );

    expect(manager.history).toHaveLength(1);
    expect(manager.history[0]?.type).toBe('system');
    expect(manager.history[0]?.data).toMatchObject({ content: 'Conversation cleared.' });
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
    const registry = new CommandRegistry();
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
      createSession(),
      registry,
      manager,
      reloadPluginCommandSource,
    );

    expect(registry.getCommands().map((command) => command.name)).toEqual(['fresh-skill']);
  });
});
