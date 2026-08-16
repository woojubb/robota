import { evaluatePermission } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { AGENT_TOOL_PERMISSION_PROFILES } from '../tool-permission-profiles.js';

/**
 * CORE-030 — what THIS package says its tools do.
 *
 * The classification used to live in `@robota-sdk/agent-core`'s permission matrix, keyed on a closed
 * union of product tool names. That put a product's tool inventory in the vendor-neutral foundation
 * with nothing coupling the two lists, and they had drifted — `CodebaseRetrieval` is defined here
 * and the matrix had never heard of it, so a read-only search prompted on every call and was refused
 * in plan mode.
 *
 * Importing this package registers these profiles, which is why `evaluatePermission` below answers
 * without any setup: the registration is a side effect of the tools existing.
 */

describe('CORE-030 — this package classifies every tool it defines', () => {
  it('reads are inspection, so they run unapproved even in plan mode', () => {
    for (const tool of ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'CodebaseRetrieval']) {
      expect(AGENT_TOOL_PERMISSION_PROFILES[tool]?.riskClass, tool).toBe('inspect');
      expect(evaluatePermission(tool, {}, 'plan'), tool).toBe('auto');
    }
  });

  it('CodebaseRetrieval specifically — the tool the old matrix had never heard of', () => {
    // Named on its own because it is the concrete cost of the drift: read-only, and it used to be
    // refused in the one mode where reading is all you can do.
    expect(evaluatePermission('CodebaseRetrieval', {}, 'plan')).toBe('auto');
    expect(evaluatePermission('CodebaseRetrieval', {}, 'default')).toBe('auto');
  });

  it('asking the user is inspection — prompting for permission to prompt decides nothing', () => {
    expect(AGENT_TOOL_PERMISSION_PROFILES['AskUserQuestion']?.riskClass).toBe('inspect');
    expect(evaluatePermission('AskUserQuestion', {}, 'plan')).toBe('auto');
  });

  it('writes are modification, which is what acceptEdits stops asking about', () => {
    for (const tool of ['Write', 'Edit']) {
      expect(AGENT_TOOL_PERMISSION_PROFILES[tool]?.riskClass, tool).toBe('modify');
      expect(evaluatePermission(tool, {}, 'default'), tool).toBe('approve');
      expect(evaluatePermission(tool, {}, 'acceptEdits'), tool).toBe('auto');
      expect(evaluatePermission(tool, {}, 'plan'), tool).toBe('deny');
    }
  });

  it('shells are execution, which acceptEdits deliberately does NOT cover', () => {
    for (const tool of ['Shell', 'Bash']) {
      expect(AGENT_TOOL_PERMISSION_PROFILES[tool]?.riskClass, tool).toBe('execute');
      expect(evaluatePermission(tool, {}, 'acceptEdits'), tool).toBe('approve');
    }
  });

  it('SELFHOST-010 — ComputerView is decided like a read, Computer like a shell', () => {
    expect(AGENT_TOOL_PERMISSION_PROFILES['ComputerView']?.riskClass).toBe(
      AGENT_TOOL_PERMISSION_PROFILES['Read']?.riskClass,
    );
    expect(AGENT_TOOL_PERMISSION_PROFILES['Computer']?.riskClass).toBe(
      AGENT_TOOL_PERMISSION_PROFILES['Shell']?.riskClass,
    );
    // And the consequence the split exists for: a GUI mutation is not a file edit.
    expect(evaluatePermission('Computer', {}, 'acceptEdits')).toBe('approve');
    expect(evaluatePermission('ComputerView', {}, 'plan')).toBe('auto');
  });

  it('the tools whose patterns can be narrowed say which argument to narrow on', () => {
    // Without an argument key, `Read(/src/**)` is unevaluable — and an unevaluable deny prompts
    // rather than matching, so an operator's narrow rule silently stops narrowing anything.
    expect(AGENT_TOOL_PERMISSION_PROFILES['Read']?.argumentKey).toBe('filePath');
    expect(AGENT_TOOL_PERMISSION_PROFILES['Shell']?.argumentKey).toBe('command');
    expect(
      evaluatePermission('Shell', { command: 'rm -rf /' }, 'default', {
        deny: ['Shell(rm*)'],
        allow: ['Shell'],
      }),
    ).toBe('deny');
  });

  it('every declared profile says at least one useful thing', () => {
    // An entry with neither half is a name in a list, which is what this change removed.
    for (const [tool, profile] of Object.entries(AGENT_TOOL_PERMISSION_PROFILES)) {
      expect(
        profile.riskClass !== undefined || profile.argumentKey !== undefined,
        `${tool} declares nothing`,
      ).toBe(true);
    }
  });
});
