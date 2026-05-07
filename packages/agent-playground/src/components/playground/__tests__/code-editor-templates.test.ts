import { describe, expect, it } from 'vitest';
import { defaultCode, exampleTemplates } from '../code-editor-templates';

describe('code editor templates', () => {
  it('keeps the public template keys stable', () => {
    expect(Object.keys(exampleTemplates)).toEqual([
      'basic',
      'tools',
      'streaming',
      'multiProvider',
      'plugins',
    ]);
  });

  it('uses the basic template as the default code', () => {
    expect(defaultCode).toBe(exampleTemplates.basic.code);
  });

  it('provides complete display metadata for every template', () => {
    for (const template of Object.values(exampleTemplates)) {
      expect(template.name.trim()).not.toBe('');
      expect(template.description.trim()).not.toBe('');
      expect(template.code.trim()).not.toBe('');
    }
  });
});
