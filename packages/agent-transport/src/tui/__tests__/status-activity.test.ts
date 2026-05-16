import { describe, expect, it } from 'vitest';
import { formatStatusActivity } from '../status-activity.js';

describe('formatStatusActivity', () => {
  it('prioritizes running tools over thinking, background work, and queued prompts', () => {
    const activity = formatStatusActivity({
      isThinking: true,
      activeToolCount: 2,
      activeBackgroundTaskCount: 3,
      hasPendingPrompt: true,
    });

    expect(activity.kind).toBe('tools');
    expect(activity.label).toBe('Tools x2');
    expect(activity.color).toBe('cyan');
    expect(activity.segments).toEqual(['queued']);
    expect(activity.text).toBe('Tools x2 · queued');
  });

  it('shows thinking as the primary model waiting state', () => {
    const activity = formatStatusActivity({
      isThinking: true,
      activeToolCount: 0,
      activeBackgroundTaskCount: 0,
      hasPendingPrompt: false,
    });

    expect(activity.kind).toBe('thinking');
    expect(activity.label).toBe('Thinking');
    expect(activity.segments).toEqual([]);
  });

  it('shows background activity when foreground work is idle', () => {
    const activity = formatStatusActivity({
      isThinking: false,
      activeToolCount: 0,
      activeBackgroundTaskCount: 1,
      hasPendingPrompt: false,
    });

    expect(activity.kind).toBe('background');
    expect(activity.label).toBe('Background x1');
    expect(activity.color).toBe('cyan');
  });

  it('shows queued prompt before idle when no work is active', () => {
    const activity = formatStatusActivity({
      isThinking: false,
      activeToolCount: 0,
      activeBackgroundTaskCount: 0,
      hasPendingPrompt: true,
    });

    expect(activity.kind).toBe('queued');
    expect(activity.label).toBe('Queued');
    expect(activity.color).toBe('yellow');
  });

  it('keeps idle compact and dim', () => {
    const activity = formatStatusActivity({
      isThinking: false,
      activeToolCount: 0,
      activeBackgroundTaskCount: 0,
      hasPendingPrompt: false,
    });

    expect(activity.kind).toBe('idle');
    expect(activity.text).toBe('Idle');
    expect(activity.color).toBe('gray');
  });
});
