import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InstallGuide } from '../code-export/install-guide';

describe('InstallGuide', () => {
  it('installs the package the generated code imports for the selected provider', () => {
    render(<InstallGuide provider="anthropic" />);

    expect(screen.getByText(/^npm install/).textContent).toBe(
      'npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-anthropic',
    );
  });
});
