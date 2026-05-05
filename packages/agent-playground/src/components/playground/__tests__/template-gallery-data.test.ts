import { describe, expect, it } from 'vitest';
import {
  categoryIcons,
  difficultyColors,
  providerIcons,
  templates,
} from '../template-gallery-data';

describe('template gallery data', () => {
  it('keeps the curated template ids stable', () => {
    expect(templates.map((template) => template.id)).toEqual([
      'basic-chat',
      'tool-enabled',
      'claude-creative',
      'business-analyst',
      'multi-modal',
      'knowledge-base',
    ]);
  });

  it('keeps display maps aligned with template values', () => {
    for (const template of templates) {
      expect(categoryIcons[template.category]).toBeDefined();
      expect(providerIcons[template.provider]).toBeDefined();
      expect(difficultyColors[template.difficulty]).toBeDefined();
    }
  });

  it('provides complete template metadata', () => {
    for (const template of templates) {
      expect(template.name.trim()).not.toBe('');
      expect(template.description.trim()).not.toBe('');
      expect(template.features.length).toBeGreaterThan(0);
      expect(template.useCases.length).toBeGreaterThan(0);
      expect(template.code.trim()).not.toBe('');
      expect(template.config.model.trim()).not.toBe('');
      expect(template.config.temperature.trim()).not.toBe('');
    }
  });
});
