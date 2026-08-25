import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PluginContainerBlock } from '../plugin-container-block';
import { PLUGIN_CATEGORIES, PLUGIN_PRIORITIES } from '../plugin-container-block-types';

import type { IPluginBlock } from '../plugin-container-block-types';

/**
 * The component was exported with no consumer anywhere in the repository, and `orphan-exports` passed
 * over it because a sibling file's header sentence — " * Types, constants, and utilities for
 * PluginContainerBlock" — contains the name. **A sentence describing a file satisfied "someone uses
 * it."** (issue #2362; the scan blind spot is issue #2258 / HARNESS-123.)
 *
 * The fix is not to unexport it: `content/v2.0.0/examples/playground-implementation.md:136-141`
 * documents importing and rendering it, and this repository does not remove a surface for having few
 * callers. The fix is to make "no consumer" untrue, and a test is the consumer that also proves the
 * component works — which is what its sibling `agent-container-block` already has.
 */
function block(id: string, name: string, priority: number): IPluginBlock {
  return {
    id,
    plugin: {
      name,
      version: '1.0.0',
      initialize: async () => undefined,
      dispose: async () => undefined,
    },
    isActive: true,
    isEnabled: true,
    category: PLUGIN_CATEGORIES.STORAGE,
    priority,
    options: {},
    stats: { calls: 0, errors: 0 },
    validationErrors: [],
  };
}

describe('PluginContainerBlock', () => {
  it('renders the plugins it is given', () => {
    render(
      <PluginContainerBlock
        plugins={[block('a', 'HistoryPlugin', PLUGIN_PRIORITIES.DEFAULT)]}
        onPluginsChange={vi.fn()}
      />,
    );
    expect(screen.getByText('HistoryPlugin')).toBeTruthy();
  });

  it('says so when there are none, rather than rendering an empty frame', () => {
    // The positive control for the case above: without it, the first assertion would also hold in a
    // component that rendered every name it was ever given and never cleared, and "renders plugins"
    // would be proved by a component that cannot represent the empty case at all.
    render(<PluginContainerBlock plugins={[]} onPluginsChange={vi.fn()} />);
    expect(screen.getByText('No plugins configured')).toBeTruthy();
    expect(screen.queryByText('HistoryPlugin')).toBeNull();
  });

  it('orders plugins by descending priority', () => {
    // The list is sorted before rendering, and a sort is the kind of thing a mount-only smoke test
    // cannot see. Asserting the ORDER, not just presence.
    render(
      <PluginContainerBlock
        plugins={[
          block('low', 'LowPlugin', PLUGIN_PRIORITIES.LOW),
          block('high', 'HighPlugin', PLUGIN_PRIORITIES.CRITICAL),
        ]}
        onPluginsChange={vi.fn()}
      />,
    );
    const rendered = screen.getAllByText(/Plugin$/).map((node) => node.textContent);
    expect(rendered.indexOf('HighPlugin')).toBeLessThan(rendered.indexOf('LowPlugin'));
  });
});
