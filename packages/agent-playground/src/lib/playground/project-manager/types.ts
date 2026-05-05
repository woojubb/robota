import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TPlaygroundProvider = 'openai' | 'anthropic' | 'google';

export interface IProjectConfig extends Record<string, TUniversalValue> {
  model: string;
  temperature: string;
}

export interface IPlaygroundProject {
  id: string;
  name: string;
  description?: string;
  code: string;
  provider: TPlaygroundProvider;
  config: IProjectConfig;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export interface IProjectMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  provider: TPlaygroundProvider;
  linesOfCode: number;
}

export interface IProjectSettings extends Record<string, TUniversalValue> {
  provider: TPlaygroundProvider;
  model?: string;
  temperature?: string;
}

export interface IProjectStats {
  totalProjects: number;
  totalLinesOfCode: number;
  providers: Record<TPlaygroundProvider, number>;
  recentActivity: number;
}
