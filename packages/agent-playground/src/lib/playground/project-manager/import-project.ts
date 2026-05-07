import type { TUniversalValue } from '@robota-sdk/agent-core';
import { CURRENT_VERSION } from './constants';
import { isProjectRecord, parseProjectConfig } from './project-value';
import { isPlaygroundProvider } from './provider';
import type { IPlaygroundProject } from './types';

export function createImportedProject(
  projectData: TUniversalValue,
  id: string,
  now: Date,
): IPlaygroundProject {
  if (!isProjectRecord(projectData)) {
    throw new Error('Invalid project data: expected an object');
  }

  const { name, code, provider, description, config } = projectData;
  if (typeof name !== 'string' || typeof code !== 'string') {
    throw new Error('Invalid project data: missing required fields');
  }
  if (!isPlaygroundProvider(provider)) {
    throw new Error('Invalid project data: invalid provider');
  }

  const parsedConfig = parseProjectConfig(config);
  if (!parsedConfig) {
    if (!isProjectRecord(config)) {
      throw new Error('Invalid project data: invalid config');
    }
    throw new Error('Invalid project data: config.model and config.temperature are required');
  }

  return {
    id,
    name: `${name} (Imported)`,
    description: typeof description === 'string' ? description : undefined,
    code,
    provider,
    config: parsedConfig,
    createdAt: now,
    updatedAt: now,
    version: CURRENT_VERSION,
  };
}
