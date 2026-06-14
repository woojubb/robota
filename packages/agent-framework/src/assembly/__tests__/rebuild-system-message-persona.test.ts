import { describe, expect, it } from 'vitest';

import { buildSessionSystemPrompt } from '../create-session-runtime.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { ISystemPromptParams } from '../../context/system-prompt-builder.js';
import type { ITerminalOutput } from '@robota-sdk/agent-session';

/**
 * PRESET-014: the `rebuildSystemMessage` closure returned by `buildSessionSystemPrompt` tracks a
 * mutable persona. A persona override re-applies a new persona (TC-01) and is retained for
 * subsequent override-less rebuilds — the staleness-refresh path (TC-02).
 */

const NOOP_TERMINAL: ITerminalOutput = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};

/** A stub prompt builder that surfaces only the persona, so tests assert directly on it. */
function personaOnlyBuilder(params: ISystemPromptParams): string {
  return `PROMPT[persona=${params.persona ?? '<none>'}]`;
}

function makeOptions(persona?: string): ICreateSessionOptions {
  return {
    config: {
      defaultTrustLevel: 'safe',
      provider: { name: 'test', model: 'test-model', apiKey: undefined },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: 'A0', claudeMd: 'C0' },
    terminal: NOOP_TERMINAL,
    systemPromptBuilder: personaOnlyBuilder,
    ...(persona !== undefined ? { persona } : {}),
  };
}

function buildRebuilder(
  persona?: string,
): (agentsMd: string, claudeMd: string, overrides?: { persona?: string }) => string {
  const { rebuildSystemMessage } = buildSessionSystemPrompt(
    makeOptions(persona),
    '/workspace',
    [],
    undefined,
    undefined,
    [],
    [],
  );
  return rebuildSystemMessage;
}

describe('rebuildSystemMessage persona override (PRESET-014)', () => {
  it('TC-01: an override persona is reflected in the rebuilt system message', () => {
    const rebuild = buildRebuilder('INITIAL_PERSONA');
    const result = rebuild('A1', 'C1', { persona: 'NEW_PERSONA_X' });
    expect(result).toContain('NEW_PERSONA_X');
    expect(result).not.toContain('INITIAL_PERSONA');
  });

  it('TC-02: a later override-less rebuild retains the previously overridden persona', () => {
    const rebuild = buildRebuilder('INITIAL_PERSONA');
    rebuild('A1', 'C1', { persona: 'NEW_PERSONA_X' });
    // Staleness refresh passes no override — the latest persona must persist.
    const result = rebuild('A2', 'C2');
    expect(result).toContain('NEW_PERSONA_X');
  });
});
