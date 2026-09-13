import * as tui from '../index.js';

import { describe, expect, it } from 'vitest';

describe('TUI presentation boundary (ARCH-011)', () => {
  it('exports presentation hosts without claiming borrowed-session transport conformance', () => {
    expect(tui).not.toHaveProperty('TuiTransport');
    expect(tui).toHaveProperty('renderApp');
    expect(tui).toHaveProperty('createDefaultTuiCliAdapter');
  });
});
