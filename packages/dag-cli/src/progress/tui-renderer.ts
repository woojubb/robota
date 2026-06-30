import type { TRunProgressEvent } from '@robota-sdk/dag-core';
import type { IRuntimeRunProgressEventBusPort } from '@robota-sdk/dag-api';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import {
  buildFlowLayout,
  renderFlowLayout,
  statusIcon,
  type TNodeStatus,
  type IFlowLayout,
} from '../renderer/flow-lines.js';

const SPINNER_FRAMES = ['⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 100;

/**
 * Live TUI renderer for `dag run --tui`.
 *
 * Renders a progressively-revealed ASCII flow diagram in the terminal,
 * updating in-place as nodes start, complete, or fail.
 *
 * Falls back to RunProgressRenderer if stdout is not a TTY or CI is set.
 */
export class TuiRenderer {
  private readonly io: IDagCliIo;
  private readonly dag: IDagDefinition;
  private readonly layout: IFlowLayout;
  private readonly statuses = new Map<string, TNodeStatus>();
  private readonly visibleGroupIndices = new Set<number>();
  private readonly faninProgress = new Map<number, number>();
  private lineCount = 0;
  private spinnerFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private fileName = '';

  public constructor(io: IDagCliIo, dag: IDagDefinition) {
    this.io = io;
    this.dag = dag;
    this.layout = buildFlowLayout(dag);
  }

  public attach(eventBus: IRuntimeRunProgressEventBusPort, fileName: string): void {
    this.fileName = fileName;
    process.stdout.write(`Running: ${fileName}\n`);
    this.lineCount = 0;

    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      const hasRunning = [...this.statuses.values()].some((s) => s === 'running');
      if (hasRunning) {
        this.render();
      }
    }, SPINNER_INTERVAL_MS);

    this.unsubscribe = eventBus.subscribe((event: TRunProgressEvent) => {
      this.handleEvent(event);
    });
  }

  public detach(): void {
    if (this.spinnerInterval !== null) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleEvent(event: TRunProgressEvent): void {
    if (event.eventType === 'task.started') {
      this.statuses.set(event.nodeId, 'running');
      this.makeGroupsVisibleForNode(event.nodeId, 'started');
      this.render();
    } else if (event.eventType === 'task.completed') {
      this.statuses.set(event.nodeId, 'done');
      this.makeGroupsVisibleForNode(event.nodeId, 'completed');
      this.render();
    } else if (event.eventType === 'task.failed') {
      this.statuses.set(event.nodeId, 'error');
      this.render();
    } else if (
      event.eventType === 'execution.completed' ||
      event.eventType === 'execution.failed'
    ) {
      this.render();
    }
  }

  /**
   * Make relevant layout groups visible based on node state change.
   */
  private makeGroupsVisibleForNode(nodeId: string, phase: 'started' | 'completed'): void {
    const groups = this.layout.groups;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (!group) continue;

      if (phase === 'started') {
        // When a node starts running, make root or any group containing it as a source visible
        if (group.kind === 'root' && group.nodeId === nodeId) {
          this.visibleGroupIndices.add(i);
        }
      }

      if (phase === 'completed') {
        // When a node completes, make groups where it is the source visible
        if (group.kind === 'single' && group.from === nodeId) {
          this.visibleGroupIndices.add(i);
        } else if (group.kind === 'fanout' && group.from === nodeId) {
          this.visibleGroupIndices.add(i);
        } else if (group.kind === 'fanin' && group.sources.includes(nodeId)) {
          // Track progress for fanin groups
          const current = this.faninProgress.get(i) ?? 0;
          this.faninProgress.set(i, current + 1);
          this.visibleGroupIndices.add(i);
        }
      }
    }
  }

  /**
   * Clear previous rendered lines and reprint visible groups.
   */
  private render(): void {
    // Clear previously rendered lines
    if (this.lineCount > 0) {
      // Move cursor up lineCount lines, then clear each line
      process.stdout.write(`\x1b[${this.lineCount}A`);
      for (let i = 0; i < this.lineCount; i++) {
        process.stdout.write('\x1b[2K\n');
      }
      // Move back up after clearing
      process.stdout.write(`\x1b[${this.lineCount}A`);
    }

    const allLines = this.renderVisibleGroups();
    for (const line of allLines) {
      process.stdout.write(line + '\n');
    }
    this.lineCount = allLines.length;
  }

  /**
   * Render only the visible groups, applying fanin partial rendering.
   */
  private renderVisibleGroups(): string[] {
    const lines: string[] = [];
    const groups = this.layout.groups;

    for (let i = 0; i < groups.length; i++) {
      if (!this.visibleGroupIndices.has(i)) continue;

      const group = groups[i];
      if (!group) continue;

      if (group.kind === 'fanin') {
        // Partial fanin rendering based on progress
        const progress = this.faninProgress.get(i) ?? 0;
        const partialLines = this.renderFaninPartial(group.sources, group.to, progress);
        lines.push(...partialLines);
      } else {
        // Normal rendering for all other group types
        const groupLines = renderFlowLayout({ groups: [group] }, this.statuses, this.spinnerFrame);
        lines.push(...groupLines);
      }
    }

    return lines;
  }

  /**
   * Render a fanin group partially — only show completed sources + the last line if all done.
   */
  private renderFaninPartial(sources: string[], to: string, progress: number): string[] {
    const lines: string[] = [];
    const completedSources = sources.slice(0, progress);

    for (let i = 0; i < completedSources.length; i++) {
      const src = completedSources[i] as string;
      const srcIcon = statusIcon(this.statuses.get(src) ?? 'pending', this.spinnerFrame);

      if (i === completedSources.length - 1 && progress >= sources.length) {
        // All sources done — show the final fanin line with target
        const tgtIcon = statusIcon(this.statuses.get(to) ?? 'pending', this.spinnerFrame);
        lines.push(`${srcIcon} ${src} ──┴──▶ ${tgtIcon} ${to}`);
      } else if (i === 0) {
        lines.push(`${srcIcon} ${src} ──┐`);
      } else {
        lines.push(`${srcIcon} ${src} ──┤`);
      }
    }

    // If all sources completed, ensure the final line is shown
    if (progress >= sources.length && completedSources.length > 0) {
      // Already handled above for the last source
    } else if (progress >= sources.length) {
      // Edge case: progress = sources.length but no completedSources shown (shouldn't happen)
      const lastSrc = sources[sources.length - 1] as string;
      const srcIcon = statusIcon(this.statuses.get(lastSrc) ?? 'pending', this.spinnerFrame);
      const tgtIcon = statusIcon(this.statuses.get(to) ?? 'pending', this.spinnerFrame);
      lines.push(`${srcIcon} ${lastSrc} ──┴──▶ ${tgtIcon} ${to}`);
    }

    return lines;
  }
}

/**
 * Check if TUI mode should be used.
 * Returns false if stdout is not a TTY or CI environment is detected.
 */
export function isTuiAvailable(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env['CI'] === 'true') return false;
  return true;
}
