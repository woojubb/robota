import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { ProductDisplayNameProvider } from '../product-display-name-context.js';
import { RoleLabel } from '../RoleLabel.js';
import StreamingIndicator from '../StreamingIndicator.js';
import TransportTUI from '../TransportTUI.js';
import { useTerminalTitle } from '../use-terminal-title.js';

describe('host-selected terminal display name', () => {
  it('uses the host name for history and streaming labels', () => {
    const history = render(
      <ProductDisplayNameProvider name="Atlas">
        <RoleLabel role="assistant" />
      </ProductDisplayNameProvider>,
    );
    const streaming = render(
      <ProductDisplayNameProvider name="Atlas">
        <StreamingIndicator text="Hello" activeTools={[]} />
      </ProductDisplayNameProvider>,
    );

    expect(history.lastFrame()).toContain('Atlas:');
    expect(streaming.lastFrame()).toContain('Atlas:');
    expect(history.lastFrame()).not.toContain('Robota:');
    expect(streaming.lastFrame()).not.toContain('Robota:');
  });

  it('uses a neutral name when the host does not choose one', () => {
    const { lastFrame } = render(<RoleLabel role="assistant" />);
    expect(lastFrame()).toContain('Assistant:');
  });

  it('uses the host name in transport restart copy', () => {
    const { lastFrame } = render(
      <ProductDisplayNameProvider name="Atlas">
        <TransportTUI
          registry={{ getAll: () => [], setEnabled: vi.fn(), setOptions: vi.fn() }}
          onClose={vi.fn()}
        />
      </ProductDisplayNameProvider>,
    );

    expect(lastFrame()).toContain('applies the next time Atlas starts');
  });

  it('sanitizes the host name before writing the terminal title', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    function Title(): null {
      useTerminalTitle('session');
      return null;
    }
    try {
      const mounted = render(
        <ProductDisplayNameProvider name={'Atlas\x07\x1b]52;c;evil\x07'}>
          <Title />
        </ProductDisplayNameProvider>,
      );
      expect(write).toHaveBeenCalledWith('\x1b]0;Atlas — session\x07');
      mounted.unmount();
    } finally {
      write.mockRestore();
    }
  });
});
