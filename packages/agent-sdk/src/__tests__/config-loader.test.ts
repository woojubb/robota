import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig } from '../config/config-loader.js';

const TMP_BASE = join(tmpdir(), 'robota-cli-test-' + process.pid);

function setupDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

describe('loadConfig', () => {
  let cwd: string;
  let projectDir: string;
  let userDir: string;
  let claudeProjectDir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    cwd = join(TMP_BASE, 'cwd-' + Math.random().toString(36).slice(2));
    projectDir = join(cwd, '.robota');
    claudeProjectDir = join(cwd, '.claude');
    const homeBase = join(TMP_BASE, 'home-' + Math.random().toString(36).slice(2));
    userDir = join(homeBase, '.robota');
    setupDir(cwd);
    setupDir(projectDir);
    setupDir(userDir);
    setupDir(claudeProjectDir);
    process.env.HOME = homeBase;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (existsSync(TMP_BASE)) {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  it('returns default config when no settings files exist', async () => {
    const config = await loadConfig(cwd);
    expect(config.defaultTrustLevel).toBe('moderate');
    expect(config.permissions.allow).toEqual([]);
    expect(config.permissions.deny).toEqual([]);
    expect(config.env).toEqual({});
  });

  it('loads project settings from .robota/settings.json', async () => {
    writeJson(join(projectDir, 'settings.json'), {
      defaultTrustLevel: 'safe',
      provider: { model: 'claude-3-5-sonnet-20241022' },
    });
    const config = await loadConfig(cwd);
    expect(config.defaultTrustLevel).toBe('safe');
    expect(config.provider.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('loads user settings from ~/.robota/settings.json', async () => {
    writeJson(join(userDir, 'settings.json'), {
      defaultTrustLevel: 'full',
    });
    const config = await loadConfig(cwd);
    expect(config.defaultTrustLevel).toBe('full');
  });

  it('project settings take precedence over user settings', async () => {
    writeJson(join(userDir, 'settings.json'), {
      defaultTrustLevel: 'safe',
      provider: { model: 'claude-3-haiku-20240307' },
    });
    writeJson(join(projectDir, 'settings.json'), {
      defaultTrustLevel: 'moderate',
    });
    const config = await loadConfig(cwd);
    expect(config.defaultTrustLevel).toBe('moderate');
    // model from user settings is still inherited when not overridden
    expect(config.provider.model).toBe('claude-3-haiku-20240307');
  });

  it('local settings take precedence over project settings', async () => {
    writeJson(join(projectDir, 'settings.json'), {
      defaultTrustLevel: 'safe',
    });
    writeJson(join(projectDir, 'settings.local.json'), {
      defaultTrustLevel: 'full',
    });
    const config = await loadConfig(cwd);
    expect(config.defaultTrustLevel).toBe('full');
  });

  it('merges permissions arrays (local overrides project overrides user)', async () => {
    writeJson(join(userDir, 'settings.json'), {
      permissions: { allow: ['Bash(git *)'] },
    });
    writeJson(join(projectDir, 'settings.json'), {
      permissions: { allow: ['Read(**)', 'Glob(**)'] },
    });
    const config = await loadConfig(cwd);
    // project overrides user permissions entirely
    expect(config.permissions.allow).toEqual(['Read(**)', 'Glob(**)']);
  });

  it('throws on invalid settings (Zod validation)', async () => {
    writeJson(join(projectDir, 'settings.json'), {
      defaultTrustLevel: 'INVALID_VALUE',
    });
    await expect(loadConfig(cwd)).rejects.toThrow();
  });

  it('resolves $ENV: prefix in apiKey', async () => {
    process.env.TEST_API_KEY_XYZ = 'sk-test-value';
    writeJson(join(projectDir, 'settings.json'), {
      provider: { apiKey: '$ENV:TEST_API_KEY_XYZ' },
    });
    const config = await loadConfig(cwd);
    expect(config.provider.apiKey).toBe('sk-test-value');
    delete process.env.TEST_API_KEY_XYZ;
  });

  // --- .claude/ path support ---

  it('loads settings from .claude/settings.json', async () => {
    writeJson(join(claudeProjectDir, 'settings.json'), {
      defaultTrustLevel: 'full',
    });
    const config = await loadConfig(cwd);
    expect(config.defaultTrustLevel).toBe('full');
  });

  it('.claude/settings.local.json has highest priority', async () => {
    writeJson(join(claudeProjectDir, 'settings.json'), {
      defaultTrustLevel: 'safe',
    });
    writeJson(join(claudeProjectDir, 'settings.local.json'), {
      defaultTrustLevel: 'full',
    });
    const config = await loadConfig(cwd);
    expect(config.defaultTrustLevel).toBe('full');
  });

  it('.claude/ paths win over legacy .robota/ paths', async () => {
    writeJson(join(projectDir, 'settings.json'), {
      defaultTrustLevel: 'safe',
      provider: { model: 'legacy-model' },
    });
    writeJson(join(claudeProjectDir, 'settings.json'), {
      defaultTrustLevel: 'full',
    });
    const config = await loadConfig(cwd);
    // .claude/ wins for trust level
    expect(config.defaultTrustLevel).toBe('full');
    // .robota/ model is inherited since .claude/ didn't set it
    expect(config.provider.model).toBe('legacy-model');
  });

  it('full 5-layer precedence: .claude/settings.local.json wins over all', async () => {
    writeJson(join(userDir, 'settings.json'), { defaultTrustLevel: 'safe' });
    writeJson(join(projectDir, 'settings.json'), { defaultTrustLevel: 'safe' });
    writeJson(join(projectDir, 'settings.local.json'), { defaultTrustLevel: 'safe' });
    writeJson(join(claudeProjectDir, 'settings.json'), { defaultTrustLevel: 'safe' });
    writeJson(join(claudeProjectDir, 'settings.local.json'), { defaultTrustLevel: 'full' });
    const config = await loadConfig(cwd);
    expect(config.defaultTrustLevel).toBe('full');
  });

  it('hooks from .claude/settings.json are loaded and merged', async () => {
    writeJson(join(claudeProjectDir, 'settings.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo test' }] }],
      },
    });
    const config = await loadConfig(cwd);
    expect(config.hooks).toBeDefined();
    expect(config.hooks?.PreToolUse).toHaveLength(1);
    expect(config.hooks?.PreToolUse?.[0]?.matcher).toBe('Bash');
  });

  it('hooks support all Phase 1 event types', async () => {
    const allEvents = {
      PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'echo pre' }] }],
      PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'echo post' }] }],
      SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo start' }] }],
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo stop' }] }],
      PreCompact: [{ matcher: '', hooks: [{ type: 'command', command: 'echo prec' }] }],
      PostCompact: [{ matcher: '', hooks: [{ type: 'command', command: 'echo postc' }] }],
      UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'echo prompt' }] }],
      Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'echo notify' }] }],
    };
    writeJson(join(claudeProjectDir, 'settings.json'), { hooks: allEvents });
    const config = await loadConfig(cwd);
    expect(config.hooks).toBeDefined();
    expect(Object.keys(config.hooks ?? {})).toHaveLength(8);
  });

  it('hooks support http hook type', async () => {
    writeJson(join(claudeProjectDir, 'settings.json'), {
      hooks: {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'https://example.com/hook' }] }],
      },
    });
    const config = await loadConfig(cwd);
    expect(config.hooks?.PreToolUse?.[0]?.hooks[0]).toEqual({
      type: 'http',
      url: 'https://example.com/hook',
    });
  });

  // --- enabledPlugins and extraKnownMarketplaces ---

  it('loads enabledPlugins from settings', async () => {
    writeJson(join(claudeProjectDir, 'settings.json'), {
      enabledPlugins: { 'my-plugin': true, 'other-plugin': false },
    });
    const config = await loadConfig(cwd);
    expect(config.enabledPlugins).toEqual({ 'my-plugin': true, 'other-plugin': false });
  });

  it('loads extraKnownMarketplaces from settings', async () => {
    writeJson(join(claudeProjectDir, 'settings.json'), {
      extraKnownMarketplaces: ['https://marketplace.example.com'],
    });
    const config = await loadConfig(cwd);
    expect(config.extraKnownMarketplaces).toEqual(['https://marketplace.example.com']);
  });
});
