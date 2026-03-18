/**
 * Module management delegate for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 * All public method signatures are preserved via delegation.
 */
import type { IModule } from '../abstracts/abstract-module';
import type { ModuleRegistry } from '../managers/module-registry';
import type { IModuleResultData, IModuleExecutionContext } from '../abstracts/abstract-module';
import type { ILogger } from '../utils/logger';

/**
 * Manages module lifecycle on behalf of a Robota instance.
 * @internal
 */
export class RobotaModuleManager {
  constructor(
    private readonly agentName: string,
    private readonly moduleRegistry: ModuleRegistry,
    private readonly logger: ILogger,
    private readonly isReady: () => boolean,
    private readonly ensureReady: () => Promise<void>,
  ) {}

  /**
   * Register a new module with the agent
   */
  async registerModule(
    module: IModule,
    options?: { autoInitialize?: boolean; validateDependencies?: boolean },
  ): Promise<void> {
    await this.ensureReady();

    await this.moduleRegistry.registerModule(module, {
      autoInitialize: options?.autoInitialize ?? true,
      validateDependencies: options?.validateDependencies ?? true,
    });

    this.logger.info('Module registered', {
      moduleName: module.name,
      moduleType: module.getModuleType().type,
    });
  }

  /**
   * Unregister a module from the agent
   */
  async unregisterModule(moduleName: string): Promise<boolean> {
    if (!this.isReady()) {
      return false;
    }

    const result = await this.moduleRegistry.unregisterModule(moduleName);

    if (result) {
      this.logger.info('Module unregistered', { moduleName });
    }

    return result;
  }

  /**
   * Get a module by name
   */
  getModule(moduleName: string): IModule | undefined {
    if (!this.isReady()) {
      return undefined;
    }
    return this.moduleRegistry.getModule(moduleName);
  }

  /**
   * Get modules by type
   */
  getModulesByType(moduleType: string): IModule[] {
    if (!this.isReady()) {
      return [];
    }
    return this.moduleRegistry.getModulesByType(moduleType);
  }

  /**
   * Get all registered modules
   */
  getModules(): IModule[] {
    if (!this.isReady()) {
      return [];
    }
    return this.moduleRegistry.getAllModules();
  }

  /**
   * Get all registered module names
   */
  getModuleNames(): string[] {
    if (!this.isReady()) {
      return [];
    }
    return this.moduleRegistry.getModuleNames();
  }

  /**
   * Check if a module is registered
   */
  hasModule(moduleName: string): boolean {
    if (!this.isReady()) {
      return false;
    }
    return this.moduleRegistry.hasModule(moduleName);
  }

  /**
   * Execute a module by name
   */
  async executeModule(
    moduleName: string,
    context: {
      executionId?: string;
      sessionId?: string;
      userId?: string;
      metadata?: Record<string, string | number | boolean | Date>;
    },
  ): Promise<{ success: boolean; data?: IModuleResultData; error?: Error; duration?: number }> {
    await this.ensureReady();

    const executionContext: IModuleExecutionContext = {
      agentName: this.agentName,
      ...(context.executionId && { executionId: context.executionId }),
      ...(context.sessionId && { sessionId: context.sessionId }),
      ...(context.userId && { userId: context.userId }),
      ...(context.metadata && { metadata: context.metadata }),
    };

    return await this.moduleRegistry.executeModule(moduleName, executionContext);
  }

  /**
   * Get module execution statistics
   */
  getModuleStats(moduleName: string):
    | {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        averageExecutionTime: number;
        lastExecutionTime?: Date;
      }
    | undefined {
    if (!this.isReady()) {
      return undefined;
    }
    return this.moduleRegistry.getModuleStats(moduleName);
  }
}
