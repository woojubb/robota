import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import UpdateNotice from '../UpdateNotice.js';

describe('UpdateNotice', () => {
  it('renders an update notice outside session history', () => {
    const { lastFrame } = render(
      <UpdateNotice message="Fixture Agent update available. Run npm install -g '@robota-sdk/agent-cli@latest'." />,
    );

    expect(lastFrame()).toContain('Fixture Agent update available');
    expect(lastFrame()).toContain('npm install');
  });
});
