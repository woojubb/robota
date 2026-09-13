import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';

import SessionEventNotices from '../SessionEventNotices.js';

describe('SessionEventNotices', () => {
  it('renders deterministic plan, context, and branch notices', () => {
    const { lastFrame } = render(
      <SessionEventNotices
        notices={[
          { id: '1', event: 'plan_event', message: 'Plan plan approved' },
          {
            id: '2',
            event: 'context_file_refreshed',
            message: 'Context refreshed: AGENTS.md',
          },
          {
            id: '3',
            event: 'branch_event',
            message: 'Branch branch switched: main @ turn-0001',
          },
        ]}
      />,
    );

    expect(lastFrame()).toContain('Plan plan approved');
    expect(lastFrame()).toContain('Context refreshed: AGENTS.md');
    expect(lastFrame()).toContain('Branch branch switched: main @ turn-0001');
  });
});
