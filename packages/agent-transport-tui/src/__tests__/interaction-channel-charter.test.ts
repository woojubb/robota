import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const TUI_CHANNEL_SOURCE = new URL('../TuiInteractionChannel.ts', import.meta.url);
const PROJECT_STRUCTURE = new URL('../../../../.agents/project-structure.md', import.meta.url);
const INTERFACE_SPEC = new URL('../../../agent-interface-transport/docs/SPEC.md', import.meta.url);

describe('ARCH-018 interaction-channel charter', () => {
  it('does not retain nominal TUI conformance with a no-op write path', () => {
    const source = readFileSync(TUI_CHANNEL_SOURCE, 'utf8');

    expect(source).not.toContain('implements IInteractionChannel');
    expect(source).not.toMatch(/write\(_event:\s*InteractionEvent\)/);
  });

  it('documents the programmatic factory port instead of a universal transport seam', () => {
    const projectStructure = readFileSync(PROJECT_STRUCTURE, 'utf8');
    const interfaceSpec = readFileSync(INTERFACE_SPEC, 'utf8');

    expect(projectStructure).toContain('ProgrammaticInteractionChannel` (in `agent-transport`)');
    expect(projectStructure).not.toContain('interface that all interactive transports implement');
    expect(interfaceSpec).toMatch(/It is not the universal\s+transport\s+contract\./);
  });
});
