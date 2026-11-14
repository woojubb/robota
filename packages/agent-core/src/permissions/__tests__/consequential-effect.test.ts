import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
  requiresFreshApproval,
} from '../permission-gate.js';

import type { TPermissionMode } from '../types.js';

/**
 * A tool whose effect leaves the machine and cannot be taken back — a message sent, money spent, a
 * call placed — reaches a person on every call. Content the agent read on the way (a page, an email)
 * must not be able to ride a mode, an allow rule or a remembered consent into such an effect.
 */
const ALL_MODES: readonly TPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions',
  'auto',
];

beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('SendMessage', {
    argument: { key: 'to', kind: 'text' },
    riskClass: 'execute',
    consequential: true,
  });
  registerToolPermissionProfile('LookUpQuote', { riskClass: 'inspect', consequential: true });
  registerToolPermissionProfile('Notify', { riskClass: 'execute' });
});

afterEach(() => clearRegisteredToolProfiles());

describe('a consequential call', () => {
  it.each(ALL_MODES.filter((mode) => mode !== 'plan'))('asks a person in %s mode', (mode) => {
    expect(evaluatePermission('SendMessage', { to: 'friend' }, mode)).toBe('approve');
  });

  it('is refused in plan mode, whose promise is to change nothing', () => {
    expect(evaluatePermission('SendMessage', { to: 'friend' }, 'plan')).toBe('deny');
  });

  it('is refused in plan mode even when its tool declares itself inspect-class', () => {
    expect(evaluatePermission('LookUpQuote', {}, 'plan')).toBe('deny');
    expect(evaluatePermission('LookUpQuote', {}, 'default')).toBe('approve');
  });

  it('is not answered by an allow rule', () => {
    expect(
      evaluatePermission('SendMessage', { to: 'friend' }, 'default', { allow: ['SendMessage'] }),
    ).toBe('approve');
    expect(
      evaluatePermission('SendMessage', { to: 'friend' }, 'acceptEdits', {
        allow: ['SendMessage(*)'],
      }),
    ).toBe('approve');
  });

  it('is not answered by an OS sandbox auto-allow', () => {
    expect(
      evaluatePermission(
        'SendMessage',
        { to: 'friend' },
        'default',
        {},
        { sandboxAutoApproved: true },
      ),
    ).toBe('approve');
  });

  it('still loses to a deny rule and to a ceiling', () => {
    expect(
      evaluatePermission('SendMessage', { to: 'friend' }, 'bypassPermissions', {
        deny: ['SendMessage'],
      }),
    ).toBe('deny');
    expect(
      evaluatePermission('SendMessage', { to: 'friend' }, 'bypassPermissions', {}, { ceiling: [] }),
    ).toBe('deny');
  });

  it('needs fresh approval, so a remembered consent or the auto-mode classifier never answers it', () => {
    expect(requiresFreshApproval('SendMessage', { to: 'friend' })).toBe(true);
    expect(requiresFreshApproval('LookUpQuote', {})).toBe(true);
  });
});

describe('a tool that does not declare a consequential effect', () => {
  it('is decided as before', () => {
    expect(evaluatePermission('Notify', {}, 'bypassPermissions')).toBe('auto');
    expect(evaluatePermission('Notify', {}, 'default', { allow: ['Notify'] })).toBe('auto');
    expect(requiresFreshApproval('Notify', {})).toBe(false);
  });

  it('keeps an earlier declaration when a later one adds only its effect', () => {
    registerToolPermissionProfile('Notify', { consequential: true });
    expect(evaluatePermission('Notify', {}, 'bypassPermissions')).toBe('approve');
    expect(evaluatePermission('Notify', {}, 'plan')).toBe('deny');
  });
});
