import { describe, expect, it } from 'vitest';
import type { ICommand } from '@robota-sdk/agent-interface-transport';

import { createSkillExecutionPort } from '../skill-execution-port.js';

/**
 * ARCH-PROVIDER-005 TC-02: the concrete skill-execution port must reproduce the REAL inject-prompt shape
 * (XML wrap + `$ARGUMENTS` substitution + empty-shell strip). This test HOLDS the coverage that the
 * dag-node-skill tests previously carried by exercising the real `executeSkill` (they now use a stub port).
 */
function injectSkill(skillContent: string): ICommand {
  return {
    name: 'greet',
    description: 'Greet someone',
    source: 'skill',
    context: 'inject',
    skillContent,
  } as unknown as ICommand;
}

describe('createSkillExecutionPort (ARCH-PROVIDER-005 TC-02)', () => {
  it('wraps resolved content in <skill> XML and substitutes $ARGUMENTS', async () => {
    const port = createSkillExecutionPort();
    const result = await port.resolveSkill(injectSkill('Say hello to $ARGUMENTS.'), 'World');
    expect(result.mode).toBe('inject');
    expect(result.prompt).toContain('<skill name="greet">');
    expect(result.prompt).toContain('Say hello to World.');
    expect(result.prompt).toContain('</skill>');
    expect(result.prompt).toContain('Execute the "greet" skill: World');
  });

  it('strips shell interpolations (empty-shell) rather than executing them', async () => {
    const port = createSkillExecutionPort();
    const result = await port.resolveSkill(injectSkill('Context: !`whoami` done.'), '');
    expect(result.mode).toBe('inject');
    // No shellExec is provided by the port → the `!`...`` interpolation is stripped, not run.
    expect(result.prompt).toContain('Context:  done.');
    expect(result.prompt).not.toContain('whoami');
  });

  it('exposes skill discovery via loadCommands', () => {
    const port = createSkillExecutionPort();
    // A directory with no skills yields an array (no throw); real discovery is filesystem-backed.
    expect(Array.isArray(port.loadCommands(process.cwd()))).toBe(true);
  });
});
