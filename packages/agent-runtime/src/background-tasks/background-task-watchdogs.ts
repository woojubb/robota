import type { IBackgroundTaskManagerOptions, TBackgroundTaskTimeoutReason } from './types.js';
import {
  hasRepeatedSentence,
  normalizeRepeatedText,
  trimRecentText,
  unrefTimer,
  type ITrackedBackgroundTask,
} from './background-task-manager-helpers.js';

export interface IBackgroundTaskWatchdogDefaults {
  agentIdleTimeoutMs: number;
  agentMaxRuntimeMs: number;
  agentOutputLimitBytes: number;
  agentMaxTextDeltas: number;
  repetitionWindow: number;
  repetitionThreshold: number;
}

const DEFAULT_AGENT_IDLE_TIMEOUT_MS = 120_000;
const DEFAULT_AGENT_MAX_RUNTIME_MS = 900_000;
const DEFAULT_AGENT_OUTPUT_LIMIT_BYTES = 256_000;
const DEFAULT_AGENT_MAX_TEXT_DELTAS = 20_000;
const DEFAULT_REPETITION_WINDOW = 800;
const DEFAULT_REPETITION_THRESHOLD = 8;

export type TBackgroundTaskWatchdogTimeoutHandler = (
  task: ITrackedBackgroundTask,
  reason: TBackgroundTaskTimeoutReason,
  message: string,
) => void;

export class BackgroundTaskWatchdogController {
  constructor(
    private readonly defaults: IBackgroundTaskWatchdogDefaults,
    private readonly onTimeout: TBackgroundTaskWatchdogTimeoutHandler,
  ) {}

  start(task: ITrackedBackgroundTask): void {
    if (task.request.kind !== 'agent') return;
    this.resetIdleTimer(task);
    const maxRuntimeMs = task.request.maxRuntimeMs ?? this.defaults.agentMaxRuntimeMs;
    if (maxRuntimeMs > 0) {
      task.maxRuntimeTimer = setTimeout(() => {
        this.onTimeout(
          task,
          'max_runtime',
          `Background agent exceeded max runtime: ${maxRuntimeMs}ms`,
        );
      }, maxRuntimeMs);
      unrefTimer(task.maxRuntimeTimer);
    }
  }

  recordActivity(task: ITrackedBackgroundTask, now: string): void {
    if (task.state.status !== 'running' && task.state.status !== 'waiting_permission') return;
    task.state.lastActivityAt = now;
    this.resetIdleTimer(task);
  }

  clear(task: ITrackedBackgroundTask): void {
    if (task.idleTimer) {
      clearTimeout(task.idleTimer);
      task.idleTimer = undefined;
    }
    if (task.maxRuntimeTimer) {
      clearTimeout(task.maxRuntimeTimer);
      task.maxRuntimeTimer = undefined;
    }
  }

  applyTextGuards(task: ITrackedBackgroundTask, delta: string): void {
    if (task.request.kind !== 'agent') return;
    task.outputBytes += Buffer.byteLength(delta, 'utf8');
    task.textDeltas += 1;
    task.recentText = trimRecentText(
      `${task.recentText}${delta}`,
      task.request.repetitionWindow ?? this.defaults.repetitionWindow,
    );

    const outputLimitBytes = task.request.outputLimitBytes ?? this.defaults.agentOutputLimitBytes;
    if (outputLimitBytes > 0 && task.outputBytes > outputLimitBytes) {
      this.onTimeout(
        task,
        'output_limit',
        `Background agent exceeded output limit: ${outputLimitBytes} bytes`,
      );
      return;
    }

    const maxTextDeltas = task.request.maxTextDeltas ?? this.defaults.agentMaxTextDeltas;
    if (maxTextDeltas > 0 && task.textDeltas > maxTextDeltas) {
      this.onTimeout(
        task,
        'output_limit',
        `Background agent exceeded text delta limit: ${maxTextDeltas}`,
      );
      return;
    }

    if (this.isRepetitiveOutput(task, delta)) {
      this.onTimeout(task, 'repetition', 'Background agent produced repetitive output');
    }
  }

  private resetIdleTimer(task: ITrackedBackgroundTask): void {
    if (task.request.kind !== 'agent') return;
    if (task.idleTimer) clearTimeout(task.idleTimer);
    const idleTimeoutMs =
      task.request.idleTimeoutMs ?? task.request.timeoutMs ?? this.defaults.agentIdleTimeoutMs;
    if (idleTimeoutMs <= 0) return;
    task.idleTimer = setTimeout(() => {
      this.onTimeout(task, 'idle', `Background agent produced no activity for ${idleTimeoutMs}ms`);
    }, idleTimeoutMs);
    unrefTimer(task.idleTimer);
  }

  private isRepetitiveOutput(task: ITrackedBackgroundTask, delta: string): boolean {
    if (task.request.kind !== 'agent') return false;
    const threshold = task.request.repetitionThreshold ?? this.defaults.repetitionThreshold;
    if (threshold <= 1) return false;
    const normalizedDelta = normalizeRepeatedText(delta);
    if (normalizedDelta && normalizedDelta === task.lastNormalizedDelta) {
      task.repeatedDeltaCount += 1;
    } else {
      task.lastNormalizedDelta = normalizedDelta;
      task.repeatedDeltaCount = normalizedDelta ? 1 : 0;
    }
    if (task.repeatedDeltaCount >= threshold) return true;
    return hasRepeatedSentence(task.recentText, threshold);
  }
}

export function createBackgroundTaskWatchdogs(
  options: IBackgroundTaskManagerOptions,
  onTimeout: TBackgroundTaskWatchdogTimeoutHandler,
): BackgroundTaskWatchdogController {
  return new BackgroundTaskWatchdogController(
    {
      agentIdleTimeoutMs: options.agentIdleTimeoutMs ?? DEFAULT_AGENT_IDLE_TIMEOUT_MS,
      agentMaxRuntimeMs: options.agentMaxRuntimeMs ?? DEFAULT_AGENT_MAX_RUNTIME_MS,
      agentOutputLimitBytes: options.agentOutputLimitBytes ?? DEFAULT_AGENT_OUTPUT_LIMIT_BYTES,
      agentMaxTextDeltas: options.agentMaxTextDeltas ?? DEFAULT_AGENT_MAX_TEXT_DELTAS,
      repetitionWindow: options.repetitionWindow ?? DEFAULT_REPETITION_WINDOW,
      repetitionThreshold: options.repetitionThreshold ?? DEFAULT_REPETITION_THRESHOLD,
    },
    onTimeout,
  );
}
