import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TUniversalValue } from '@robota-sdk/agent-core';

const STORAGE_KEY = 'robota-playground-projects';

async function loadProjectManager() {
  vi.resetModules();
  const module = await import('../project-manager');
  return module.ProjectManager.getInstance();
}

function getStoredProjects(): TUniversalValue[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  expect(stored).not.toBeNull();
  return JSON.parse(stored ?? '[]') as TUniversalValue[];
}

describe('ProjectManager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('creates a project with provider defaults and persists it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const manager = await loadProjectManager();
    const project = manager.createProject('OpenAI Project', 'Saved description', {
      provider: 'openai',
    });

    expect(project).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: 'OpenAI Project',
        description: 'Saved description',
        provider: 'openai',
        config: { model: 'gpt-4', temperature: '0.7' },
        version: '1.0.0',
      }),
    );
    expect(project.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(project.updatedAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(project.code).toContain('OpenAIProvider');

    expect(getStoredProjects()).toEqual([
      expect.objectContaining({
        id: project.id,
        name: 'OpenAI Project',
        createdAt: '2026-01-02T03:04:05.000Z',
        updatedAt: '2026-01-02T03:04:05.000Z',
      }),
    ]);
  });

  it('loads valid stored projects with Date fields and ignores invalid entries', async () => {
    const storedProjects: TUniversalValue[] = [
      {
        id: 'stored-openai',
        name: 'Stored Project',
        description: 'Restored from storage',
        code: 'const value = 1;',
        provider: 'openai',
        config: { model: 'gpt-4o', temperature: '0.3' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        version: '1.0.0',
      },
      {
        id: 'invalid-provider',
        name: 'Invalid Provider',
        code: 'const value = 2;',
        provider: 'qwen',
        config: { model: 'qwen-plus', temperature: '0.3' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        version: '1.0.0',
      },
      'invalid-entry',
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedProjects));

    const manager = await loadProjectManager();
    const projects = manager.getAllProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(
      expect.objectContaining({
        id: 'stored-openai',
        name: 'Stored Project',
        provider: 'openai',
        config: { model: 'gpt-4o', temperature: '0.3' },
      }),
    );
    expect(projects[0]?.createdAt).toBeInstanceOf(Date);
    expect(projects[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it('imports valid project data and rejects malformed imports', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));

    const manager = await loadProjectManager();
    const imported = manager.importProject({
      name: 'Imported Source',
      description: 'Portable project',
      code: 'export default agent;',
      provider: 'anthropic',
      config: { model: 'claude-3-opus', temperature: '0.8' },
    });

    expect(imported).toEqual(
      expect.objectContaining({
        name: 'Imported Source (Imported)',
        description: 'Portable project',
        provider: 'anthropic',
        config: { model: 'claude-3-opus', temperature: '0.8' },
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        updatedAt: new Date('2026-01-02T03:04:05.000Z'),
      }),
    );
    expect(manager.loadProject(imported.id)).toBe(imported);

    expect(() => manager.importProject(null)).toThrow('expected an object');
    expect(() =>
      manager.importProject({
        name: 'Wrong Provider',
        code: 'export default agent;',
        provider: 'qwen',
        config: { model: 'qwen-plus', temperature: '0.7' },
      }),
    ).toThrow('invalid provider');
    expect(() =>
      manager.importProject({
        name: 'Missing Config',
        code: 'export default agent;',
        provider: 'openai',
        config: { model: 'gpt-4' },
      }),
    ).toThrow('config.model and config.temperature are required');
  });

  it('updates, duplicates, searches, exports, and reports project stats', async () => {
    vi.useFakeTimers();
    const manager = await loadProjectManager();

    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const oldProjectId = manager.saveProject({
      name: 'Legacy Claude',
      description: 'Older project',
      code: 'const legacy = true;',
      provider: 'anthropic',
      config: { model: 'claude-3-opus', temperature: '0.8' },
    });

    vi.setSystemTime(new Date('2026-01-10T00:00:00.000Z'));
    const freshProject = manager.createProject('Fresh OpenAI', 'Weather assistant', {
      provider: 'openai',
    });

    expect(
      manager.updateProject(freshProject.id, {
        code: 'line 1\nline 2',
        description: 'Updated weather agent',
      }),
    ).toBe(true);
    expect(manager.updateProject('missing-project', { name: 'Missing' })).toBe(false);

    const duplicateId = manager.duplicateProject(freshProject.id);
    expect(duplicateId).not.toBeNull();
    expect(manager.loadProject(duplicateId ?? '')).toEqual(
      expect.objectContaining({
        name: 'Fresh OpenAI (Replica)',
        code: 'line 1\nline 2',
      }),
    );

    expect(manager.searchProjects('replica')).toEqual([
      expect.objectContaining({ id: duplicateId, name: 'Fresh OpenAI (Replica)' }),
    ]);
    expect(manager.exportProject(freshProject.id)).toContain('"name": "Fresh OpenAI"');
    expect(manager.exportProject('missing-project')).toBeNull();
    expect(manager.createFromTemplate(0)).toEqual(expect.any(String));
    expect(manager.createFromTemplate(-1)).toBeNull();
    expect(manager.getBuiltinTemplates().map((template) => template.provider)).toContain('openai');

    expect(manager.deleteProject(duplicateId ?? '')).toBe(true);
    expect(manager.deleteProject('missing-project')).toBe(false);
    expect(manager.loadProject(duplicateId ?? '')).toBeNull();

    expect(manager.getProjectStats()).toEqual({
      totalProjects: 3,
      totalLinesOfCode: expect.any(Number),
      providers: { openai: 2, anthropic: 1, google: 0 },
      recentActivity: 2,
    });
    expect(manager.loadProject(oldProjectId)).toEqual(
      expect.objectContaining({ name: 'Legacy Claude' }),
    );
  });
});
