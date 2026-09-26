import { describe, expect, it } from 'vitest';

import { parseMeshSettings } from '../mesh-settings.js';

describe('mesh settings while the mesh is off', () => {
  const malformed = {
    capabilities: ['everything'],
    dht: 'yes',
    relay: { port: 70_000 },
  };

  it('does not refuse options that only an enabled mesh would use', () => {
    expect(parseMeshSettings({ mesh: { options: malformed } }).enabled).toBe(false);
    expect(parseMeshSettings({ mesh: { enabled: false, options: malformed } }).enabled).toBe(false);
    expect(parseMeshSettings({ mesh: { enabled: false, options: 'nonsense' } }).enabled).toBe(
      false,
    );
  });

  it('still refuses them once the mesh is on', () => {
    expect(() => parseMeshSettings({ mesh: { enabled: true, options: malformed } })).toThrow(
      /Invalid mesh setting/,
    );
  });
});
