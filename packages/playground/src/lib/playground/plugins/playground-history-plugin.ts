import type { SimpleLogger, TUniversalValue } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';

export type TPlaygroundEventName =
  | 'user_message'
  | 'assistant_response'
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'tool_call_error'
  | 'execution_start'
  | 'execution_complete'
  | 'execution_error';

export interface IConversationEvent {
  id: string;
  type: TPlaygroundEventName;
  timestamp: Date;
  content?: string;
  agentId?: string;
  toolName?: string;
  metadata?: Record<string, TUniversalValue>;
}

export interface IAgentBlock {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  startTime?: Date;
  endTime?: Date;
  events: IConversationEvent[];
}

export interface IVisualizationData {
  events: IConversationEvent[];
  agents: IAgentBlock[];
}

export interface IPlaygroundHistoryPluginOptions {
  maxEvents?: number;
  enableVisualization?: boolean;
  logger?: SimpleLogger;
}

/**
 * PlaygroundHistoryPlugin
 *
 * Standalone recorder for Playground UI state. This is intentionally not coupled
 * to the SDK plugin system; it just stores events for visualization.
 */
export class PlaygroundHistoryPlugin {
  private readonly logger: SimpleLogger;
  private readonly maxEvents: number;
  private readonly enableVisualization: boolean;

  private events: IConversationEvent[] = [];

  constructor(options: IPlaygroundHistoryPluginOptions = {}) {
    this.logger = options.logger ?? SilentLogger;
    this.maxEvents = Math.max(1, options.maxEvents ?? 1000);
    this.enableVisualization = options.enableVisualization ?? true;
  }

  recordEvent(event: IConversationEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }

  getAllEvents(): IConversationEvent[] {
    return [...this.events];
  }

  clearEvents(): void {
    this.events = [];
  }

  getVisualizationData(): IVisualizationData {
    if (!this.enableVisualization) {
      return { events: this.getAllEvents(), agents: [] };
    }

    const byAgentId = new Map<string, IAgentBlock>();
    const events = this.getAllEvents();

    for (const e of events) {
      const agentId = e.agentId;
      if (!agentId) continue;

      const existing = byAgentId.get(agentId);
      if (existing) {
        existing.events.push(e);
        continue;
      }

      byAgentId.set(agentId, {
        id: agentId,
        name: agentId,
        status: 'idle',
        events: [e],
      });
    }

    return {
      events,
      agents: Array.from(byAgentId.values()),
    };
  }

  async dispose(): Promise<void> {
    this.clearEvents();
    this.logger.debug('PlaygroundHistoryPlugin disposed');
  }
}


