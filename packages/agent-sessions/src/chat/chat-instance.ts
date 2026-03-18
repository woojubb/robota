import { Robota, type IAgentConfig, type TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IChatConfig,
  IChatMetadata,
  IChatStats,
  ITemplateManager,
  IChatInstance,
} from '../types/chat';
import { TemplateManagerAdapter } from '../adapters/template-manager-adapter';

/**
 * Simple ChatInstance implementation - wrapper around Robota
 *
 * Focuses on the core purpose: managing a single AI agent instance
 * within a session context. Delegates conversation management to Robota.
 */
export class ChatInstance implements IChatInstance {
  public metadata: IChatMetadata;
  public config: IChatConfig;
  public readonly robota: Robota;
  private templateManager: ITemplateManager;

  constructor(
    metadata: IChatMetadata,
    config: IChatConfig,
    robota: Robota,
    templateManager?: ITemplateManager,
  ) {
    this.metadata = metadata;
    this.config = config;
    this.robota = robota;
    this.templateManager = templateManager ?? new TemplateManagerAdapter();
  }

  /**
   * Send a message and get AI response
   */
  async sendMessage(content: string): Promise<string> {
    try {
      const response = await this.robota.run(content);
      this.metadata.messageCount++;
      this.metadata.lastAccessedAt = new Date();
      return response;
    } catch (error) {
      throw new Error(
        `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Regenerate the last response
   */
  async regenerateResponse(): Promise<string> {
    const history = this.robota.getHistory();
    const lastUserMessage = history.filter((msg: TUniversalMessage) => msg.role === 'user').pop();

    if (!lastUserMessage) {
      throw new Error('No user message found to regenerate response for');
    }

    return this.sendMessage(lastUserMessage.content);
  }

  /**
   * Update robota configuration
   */
  async updateRobotaConfig(config: IAgentConfig): Promise<void> {
    try {
      await this.robota.configure(config);
      this.config.robotaConfig = { ...this.config.robotaConfig, ...config };
      this.metadata.updatedAt = new Date();
    } catch (error) {
      throw new Error(
        `Failed to update robota config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get current robota configuration
   */
  getRobotaConfig(): IAgentConfig {
    return this.config.robotaConfig;
  }

  /**
   * Upgrade to use an agent template
   */
  async upgradeToTemplate(templateName: string): Promise<void> {
    const template = this.templateManager.getTemplate(templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found`);
    }

    await this.updateRobotaConfig(template);
    this.config.agentTemplate = templateName;
  }

  /**
   * Get template manager instance
   */
  getTemplateManager(): ITemplateManager {
    return this.templateManager;
  }

  /**
   * Activate this chat session
   */
  activate(): void {
    this.metadata.isActive = true;
    this.metadata.lastAccessedAt = new Date();
  }

  /**
   * Deactivate this chat session
   */
  deactivate(): void {
    this.metadata.isActive = false;
  }

  /**
   * Get conversation history - delegate to Robota
   */
  getHistory(): TUniversalMessage[] {
    return this.robota.getHistory();
  }

  /**
   * Clear conversation history - delegate to Robota
   */
  clearHistory(): void {
    this.robota.clearHistory();
    this.metadata.messageCount = 0;
    this.metadata.updatedAt = new Date();
  }

  /**
   * Save chat state
   * TODO: Implement persistence using agents ConversationHistoryPlugin
   */
  async save(): Promise<void> {
    // No-op until persistence layer is implemented
  }

  /**
   * Load chat state
   * TODO: Implement loading using agents ConversationHistoryPlugin
   */
  async load(): Promise<void> {
    // No-op until persistence layer is implemented
  }

  /**
   * Get chat statistics
   */
  getStats(): IChatStats {
    return {
      messageCount: this.metadata.messageCount,
      createdAt: this.metadata.createdAt,
      lastActivity: this.metadata.lastAccessedAt,
      // TODO: Get token usage from Robota if available
    };
  }

  /**
   * Update chat configuration
   */
  updateConfig(config: Partial<IChatConfig>): void {
    Object.assign(this.config, config);
    this.metadata.updatedAt = new Date();
  }
}
