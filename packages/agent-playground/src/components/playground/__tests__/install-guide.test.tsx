import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InstallGuide } from '../code-export/install-guide';

describe('InstallGuide', () => {
  it('installs a per-vendor provider package instead of the retired monolith', () => {
    render(<InstallGuide />);

    const command = screen.getByText(/^npm install/).textContent ?? '';
    expect(command.split(' ')).not.toContain('@robota-sdk/agent-provider');
    expect(command).toMatch(/@robota-sdk\/agent-provider-\w+/);
  });
});
