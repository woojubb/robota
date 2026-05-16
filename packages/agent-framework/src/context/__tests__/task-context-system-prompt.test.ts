import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../system-prompt-builder.js';
import type { ISystemPromptParams } from '../system-prompt-builder.js';

const BASE_PARAMS: ISystemPromptParams = {
  agentsMd: '',
  claudeMd: '',
  toolDescriptions: [],
  trustLevel: 'moderate',
  projectInfo: {
    type: 'node',
    name: 'my-project',
    language: 'typescript',
    packageManager: 'pnpm',
  },
};

describe('task context system prompt integration', () => {
  it('renders active task context as a neutral section after project memory', () => {
    const result = buildSystemPrompt({
      ...BASE_PARAMS,
      memoryMd: '- Memory marker',
      taskContext: '### CLI-BL-017\n- **Status:** in-progress',
    });

    expect(result).toContain('## Active Task Context');
    expect(result).toContain('### CLI-BL-017');
    expect(result.indexOf('## Project Memory')).toBeLessThan(
      result.indexOf('## Active Task Context'),
    );
    expect(result).not.toContain('you must update task status');
  });
});
