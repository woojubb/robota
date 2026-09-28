/**
 * #3282 §2 (part 2) — `formatEffortResolution` used to print the internal-field dump
 * `Model effort: requested=…, effective=…, source=…, disposition=…` for headless `/goal` output. It
 * now uses the same plain wording `/effort` itself already uses (`EFFORT_LEVEL_LABELS`), so a person
 * reading headless output and a person reading `/effort`'s reply see the same words for the same
 * outcome.
 */
import { describe, expect, it } from 'vitest';

import { formatEffortResolution } from '../headless-output.js';

import type { IModelEffortResolution } from '../../../effort/effort-resolution.js';

function resolution(overrides: Partial<IModelEffortResolution>): IModelEffortResolution {
  return {
    requested: 'high',
    effective: 'high',
    source: 'command',
    disposition: 'applied',
    modelDefault: 'high',
    ...overrides,
  };
}

describe('formatEffortResolution (#3282 §2)', () => {
  it('reports the plain label, not the internal field dump', () => {
    const text = formatEffortResolution(resolution({ requested: 'high', disposition: 'applied' }));

    expect(text).toBe('Effort: High');
    expect(text).not.toContain('requested=');
    expect(text).not.toContain('effective=');
    expect(text).not.toContain('source=');
    expect(text).not.toContain('disposition=');
  });

  it('uses the full plain word for xhigh, not the internal id', () => {
    const text = formatEffortResolution(
      resolution({ requested: 'xhigh', effective: 'xhigh', disposition: 'applied' }),
    );

    expect(text).toBe('Effort: Extra high');
  });

  it('reports the same plain not-applied sentence /effort uses, for a model with no matching control', () => {
    const text = formatEffortResolution(
      resolution({ requested: 'low', effective: 'low', disposition: 'not-applied' }),
    );

    expect(text).toBe("This model doesn't support effort levels, so it will use its default.");
  });

  it('reports Auto\'s own label when the requested selection was auto', () => {
    const text = formatEffortResolution(
      resolution({ requested: 'auto', effective: 'high', source: 'model-default', disposition: 'model-default' }),
    );

    expect(text).toBe('Effort: Auto');
  });
});
