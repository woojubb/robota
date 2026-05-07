export interface IAgentConfigurationSnapshot {
  version: number;
  tools: Array<{ name: string; parameters?: string[] }>;
  updatedAt: number;
  metadata?: Record<string, string | number | boolean | Date | string[]>;
}

export interface IToolCard {
  id: string;
  name: string;
  description?: string;
}
