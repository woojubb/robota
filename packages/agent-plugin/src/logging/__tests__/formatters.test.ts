import { describe, it, expect } from 'vitest';
import { ConsoleLogFormatter, JsonLogFormatter } from '../formatters';
import type { ILogEntry } from '../types';

const entry: ILogEntry = {
  timestamp: new Date('2025-01-01T12:00:00Z'),
  level: 'info',
  message: 'Test message',
  context: { module: 'test' },
  metadata: { operation: 'value' },
};

describe('ConsoleLogFormatter', () => {
  const formatter = new ConsoleLogFormatter();

  it('formats entry with all fields', () => {
    const result = formatter.format(entry);
    expect(result).toContain('2025-01-01T12:00:00.000Z');
    expect(result).toContain('INFO');
    expect(result).toContain('Test message');
    expect(result).toContain('"module":"test"');
  });

  it('formats entry without context', () => {
    const noCtx: ILogEntry = { ...entry, context: undefined };
    const result = formatter.format(noCtx);
    expect(result).toContain('Test message');
    expect(result).not.toContain('module');
  });

  it('formats entry without metadata', () => {
    const noMeta: ILogEntry = { ...entry, metadata: undefined };
    const result = formatter.format(noMeta);
    expect(result).not.toContain('"operation"');
  });
});

describe('JsonLogFormatter', () => {
  const formatter = new JsonLogFormatter();

  it('formats entry as JSON string', () => {
    const result = formatter.format(entry);
    const parsed = JSON.parse(result);
    expect(parsed.message).toBe('Test message');
    expect(parsed.level).toBe('info');
    expect(parsed.timestamp).toBe('2025-01-01T12:00:00.000Z');
  });
});
