import { describe, expect, it } from 'vitest';
import { remotePermissionText } from '../remote-permission-display.js';

describe('remote permission display', () => {
  it('presents the complete request when it fits', () => {
    const event = { id: 'p1', toolName: 'Bash', toolArgs: { command: 'echo hello' } };
    expect(remotePermissionText(event)).toBe(JSON.stringify(event));
  });

  it('refuses a request whose full contents cannot be shown within the bound', () => {
    const event = { id: 'p1', toolName: 'Bash', toolArgs: { command: `${'a'.repeat(4000)}; echo hidden` } };
    expect(remotePermissionText(event)).toBeUndefined();
  });

  it('refuses display controls instead of silently changing the approved request', () => {
    const event = { id: 'p1', toolName: 'Bash', toolArgs: { command: 'echo \u202eend' } };
    expect(remotePermissionText(event)).toBeUndefined();
  });
});
