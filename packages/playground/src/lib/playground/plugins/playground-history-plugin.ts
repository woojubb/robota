import type { SimpleLogger, UniversalValue } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';

export type PlaygroundEventType =
  | 'user_message'
  | 'assistant_response'
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'tool_call_error'
  | 'execution_start'
  | 'execution_complete'
  | 'execution_error';

export interface ConversationEvent {
  id: string;
  type: PlaygroundEventType;
  timestamp: Date;
  content?: string;
  agentId?: string;
  toolName?: string;
  metadata?: Record<string, UniversalValue>;
}

export interface AgentBlock {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  startTime?: Date;
  endTime?: Date;
  events: ConversationEvent[];
}

export interface VisualizationData {
  events: ConversationEvent[];
  agents: AgentBlock[];
}

export interface PlaygroundHistoryPluginOptions {
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

  private events: ConversationEvent[] = [];

  constructor(options: PlaygroundHistoryPluginOptions = {}) {
    this.logger = options.logger ?? SilentLogger;
    this.maxEvents = Math.max(1, options.maxEvents ?? 1000);
    this.enableVisualization = options.enableVisualization ?? true;
  }

  recordEvent(event: ConversationEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }

  getAllEvents(): ConversationEvent[] {
    return [...this.events];
  }

  clearEvents(): void {
    this.events = [];
  }

  getVisualizationData(): VisualizationData {
    if (!this.enableVisualization) {
      return { events: this.getAllEvents(), agents: [] };
    }

    const byAgentId = new Map<string, AgentBlock>();
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


