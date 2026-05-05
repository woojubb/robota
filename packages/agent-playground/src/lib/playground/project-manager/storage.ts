import type { TUniversalValue } from '@robota-sdk/agent-core';
import { WebLogger } from '../../web-logger';
import { STORAGE_KEY } from './constants';
import { isProjectRecord, parseProjectConfig } from './project-value';
import { isPlaygroundProvider } from './provider';
import type { IPlaygroundProject } from './types';

export function loadProjectsFromStorage(): Map<string, IPlaygroundProject> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Map();

    const parsed: TUniversalValue = JSON.parse(stored) as TUniversalValue;
    if (!Array.isArray(parsed)) {
      WebLogger.error('Failed to load projects from storage', {
        error: 'Stored data is not an array',
      });
      return new Map();
    }

    return new Map(parseProjectEntries(parsed));
  } catch (error) {
    WebLogger.error('Failed to load projects from storage', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

export function saveProjectsToStorage(projects: ReadonlyMap<string, IPlaygroundProject>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(projects.values())));
  } catch (error) {
    WebLogger.error('Failed to save projects to storage', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function parseProjectEntries(
  parsed: TUniversalValue[],
): Array<[string, IPlaygroundProject]> {
  const projects: Array<[string, IPlaygroundProject]> = [];

  for (const item of parsed) {
    const project = parseProjectEntry(item);
    if (project) projects.push([project.id, project]);
  }

  return projects;
}

function parseProjectEntry(item: TUniversalValue): IPlaygroundProject | null {
  if (!isProjectRecord(item)) return null;

  const { id, name, code, provider, createdAt, updatedAt, version, description, config } = item;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof code !== 'string' ||
    typeof version !== 'string'
  ) {
    return null;
  }
  if (!isPlaygroundProvider(provider)) return null;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return null;

  const parsedConfig = parseProjectConfig(config);
  if (!parsedConfig) return null;

  return {
    id,
    name,
    description: typeof description === 'string' ? description : undefined,
    code,
    provider,
    config: parsedConfig,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    version,
  };
}
