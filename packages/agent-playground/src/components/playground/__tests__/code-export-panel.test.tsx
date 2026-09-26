import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { CodeExportPanel } from '../code-export/code-export-panel';

function agentConfig(provider: string): IPlaygroundAgentConfig {
  return { name: 'Agent', aiProviders: [], defaultModel: { provider, model: 'some-model' } };
}

describe('CodeExportPanel', () => {
  it('says a provider without a code template is not supported instead of inventing code', () => {
    render(<CodeExportPanel agentConfig={agentConfig('qwen')} activeTools={[]} />);

    expect(screen.getByText(/does not support the "qwen" provider/)).toBeTruthy();
    expect(screen.queryByText(/^npm install/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy code' })).toBeNull();
  });
});
