import type { Robota, IAgentConfig, TUniversalMessage } from '@robota-sdk/agent-core';

/**
 * Chat configuration interface - simplified
 */
export interface IChatConfig {
  chatName?: string;
  description?: string;
  robotaConfig: IAgentConfig; // Required for creating the agent
  agentTemplate?: string; // Optional agent template name
}

/**
 * Chat metadata interface - simplified
 */
export interface IChatMetadata {
  chatId: string;
  sessionId: string;
  chatName: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  messageCount: number;
  isActive: boolean;
}

/**
 * Template manager interface for agent templates
 */
export interface ITemplateManager {
  getTemplate(name: string): IAgentConfig | undefined;
  listTemplates(): string[];
  validateTemplate(config: IAgentConfig): boolean;
}

/**
 * Simplified chat instance interface - just a wrapper around Robota
 */
export interface IChatInstance {
  metadata: IChatMetadata;
  config: IChatConfig;
  readonly robota: Robota;

  // Core Chat Operations
  sendMessage(content: string): Promise<string>;
  regenerateResponse(): Promise<string>;

  // Configuration
  updateRobotaConfig(config: IAgentConfig): Promise<void>;
  getRobotaConfig(): IAgentConfig;

  // Agent Template Support
  upgradeToTemplate?(templateName: string): Promise<void>;
  getTemplateManager?(): ITemplateManager;

  // State Management
  activate(): void;
  deactivate(): void;

  // History Management - delegate to Robota
  getHistory(): TUniversalMessage[];
  clearHistory(): void;

  // Lifecycle
  save(): Promise<void>;
  load(): Promise<void>;

  // Utils
  getStats(): IChatStats;
  updateConfig(config: Partial<IChatConfig>): void;
}

/**
 * Chat statistics interface - simplified
 */
export interface IChatStats {
  messageCount: number;
  createdAt: Date;
  lastActivity: Date;
  totalTokens?: number;
  averageResponseTime?: number; // ms
}
