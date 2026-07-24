/**
 * CMD-004 Phase 2: `applySystemCommandResult` is pure rendering. Host actions are applied (and
 * consumed) by the session, UI intents arrive via the `ui_intent` session event, and state-change
 * notifications arrive as broadcast session events (`session_renamed`, `history_cleared`). The
 * only result-carried hint consumed here is `data.pluginRegistryReloaded` — the requester-local
 * command-registry/autocomplete refresh.
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

  it('renders the message only — UI intents are delivered via the ui_intent session event', () => {
    const manager = new TuiStateManager();

    applySystemCommandResult(
      {
        success: true,
        message: 'Opening plugin manager...',
        uiIntents: [{ type: 'show-plugin-manager' }],
      },
      createSession(),
      new CommandRegistry(),
      manager,
    );

    // Pure rendering: the message lands in history; the legacy screen effect does nothing here.
    expect(manager.history).toHaveLength(1);
    expect(manager.history[0]?.data).toMatchObject({ content: 'Opening plugin manager...' });
  });

  it('renders a host-actioned result as message only (host applied it; TUI refreshes on result)', () => {
    const manager = new TuiStateManager();

    applySystemCommandResult(
      {
        success: true,
        message: 'Status line disabled.',
      },
      createSession(),
      new CommandRegistry(),
      manager,
    );

    expect(manager.history).toHaveLength(1);
    expect(manager.history[0]?.data).toMatchObject({ content: 'Status line disabled.' });
  });

  it('appends the /clear result message AFTER the broadcast-driven clear (event fired during executeCommand)', () => {
    const manager = new TuiStateManager();
    manager.addEntry({
      id: 'old',
      timestamp: new Date('2026-05-03T00:00:00.000Z'),
      category: 'chat',
      type: 'user',
      data: { role: 'user', content: 'old message' },
    });

    // Stage E: the transcript clear itself rides the broadcast `history_cleared` session event
    // (bound in TuiInteractionChannel and emitted while the command executes — before the result
    // returns), so by the time this renderer runs the history is already empty.
    manager.clearHistory();
    applySystemCommandResult(
      {
        success: true,
        message: 'Conversation cleared.',
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
        data: { pluginRegistryReloaded: true },
      },
      createSession(),
      registry,
      manager,
      reloadPluginCommandSource,
    );

    expect(registry.getCommands().map((command) => command.name)).toEqual(['fresh-skill']);
  });
});
