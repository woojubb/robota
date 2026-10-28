import { afterEach, expect, it } from 'vitest';
import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  hasUnevaluableArgumentPattern,
  matchesAnyPattern,
  registerToolPermissionProfile,
} from '../index.js';

afterEach(() => clearRegisteredToolProfiles());

it('exposes uncertainty separately from a deny pattern non-match', () => {
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' }, riskClass: 'execute',
  });
  const args = { command: 'nohup cat .env' };
  const deny = ['Bash(cat .env)'];
  expect(matchesAnyPattern('Bash', args, deny, 'deny')).toBe(false);
  expect(hasUnevaluableArgumentPattern('Bash', args, deny)).toBe(true);
  expect(evaluatePermission('Bash', args, 'default', { deny, allow: ['Bash'] })).toBe('approve');
});
