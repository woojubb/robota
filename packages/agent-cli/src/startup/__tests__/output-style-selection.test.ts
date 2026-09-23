import { describe, expect, it } from 'vitest';

import { createOutputStyleRegistry } from '@robota-sdk/agent-preset';

import { resolveOutputStyle, selectOutputStyleId } from '../output-style-selection.js';

describe('CLI output-style selection', () => {
  it('uses CLI > settings > default precedence', () => {
    expect(selectOutputStyleId({ outputStyle: 'concise' }, 'proactive')).toBe('concise');
    expect(selectOutputStyleId({ outputStyle: undefined }, 'proactive')).toBe('proactive');
    expect(selectOutputStyleId({ outputStyle: undefined }, undefined)).toBe('default');
  });

  it('resolves through the supplied instance registry and reports unknown ids', () => {
    const registry = createOutputStyleRegistry();
    expect(resolveOutputStyle(registry, 'concise').id).toBe('concise');
    expect(() => resolveOutputStyle(registry, 'missing')).toThrow(
      /Unknown output style "missing".*concise/,
    );
  });
});
