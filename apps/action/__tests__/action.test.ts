import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ACTION_DIR = join(import.meta.dirname, '..');

describe('PM-026: GitHub Action structure', () => {
  // TC-01: action.yml contains task input and result output
  it('TC-01: action.yml defines task input and result output', () => {
    const actionYmlPath = join(ACTION_DIR, 'action.yml');
    expect(existsSync(actionYmlPath)).toBe(true);

    const content = readFileSync(actionYmlPath, 'utf8');

    // task input is required
    expect(content).toContain('task:');
    expect(content).toContain('required: true');

    // result output is defined
    expect(content).toContain('result:');
    expect(content).toContain("description: 'The agent response text'");
  });

  // TC-02: index.ts passes api-key to CLI invocation via ANTHROPIC_API_KEY env var
  it('TC-02: index.ts passes api-key to CLI via ANTHROPIC_API_KEY env var', () => {
    const indexPath = join(ACTION_DIR, 'src', 'index.ts');
    expect(existsSync(indexPath)).toBe(true);

    const content = readFileSync(indexPath, 'utf8');

    // api-key input is read
    expect(content).toContain("getInput('api-key')");

    // api-key is set as ANTHROPIC_API_KEY in env
    expect(content).toContain("env['ANTHROPIC_API_KEY'] = apiKey");
  });
});
