import { describe, it, expect } from 'vitest';
import {
  parseGlobalConfig,
  takeStringOption,
  takeNumberOption,
  rejectUnexpectedArgs,
} from '../arguments.js';

describe('takeStringOption', () => {
  it('returns empty args and no value when option is absent', () => {
    const result = takeStringOption(['foo', 'bar'], '--server-url');
    expect(result.args).toEqual(['foo', 'bar']);
    expect(result.value).toBeUndefined();
    expect(result.failure).toBeUndefined();
  });

  it('extracts value when option is present', () => {
    const result = takeStringOption(['--server-url', 'http://localhost:3000'], '--server-url');
    expect(result.value).toBe('http://localhost:3000');
    expect(result.args).toEqual([]);
    expect(result.failure).toBeUndefined();
  });

  it('removes option and value from remaining args', () => {
    const result = takeStringOption(
      ['before', '--server-url', 'http://x.com', 'after'],
      '--server-url',
    );
    expect(result.value).toBe('http://x.com');
    expect(result.args).toEqual(['before', 'after']);
  });

  it('returns failure when option has no following value', () => {
    const result = takeStringOption(['--server-url'], '--server-url');
    expect(result.failure).toBeDefined();
    expect(result.failure?.errors[0]?.detail).toContain('requires a value');
  });

  it('returns failure when option is followed by another option flag', () => {
    const result = takeStringOption(['--server-url', '--other'], '--server-url');
    expect(result.failure).toBeDefined();
  });

  it('returns failure when option is specified twice', () => {
    const result = takeStringOption(
      ['--server-url', 'http://a.com', '--server-url', 'http://b.com'],
      '--server-url',
    );
    expect(result.failure).toBeDefined();
    expect(result.failure?.errors[0]?.detail).toContain('can only be provided once');
  });
});

describe('takeNumberOption', () => {
  it('returns value when valid positive integer', () => {
    const result = takeNumberOption(['--count', '5'], '--count');
    expect(result.value).toBe('5');
    expect(result.failure).toBeUndefined();
  });

  it('returns failure when value is not a positive integer', () => {
    const result = takeNumberOption(['--count', '0'], '--count');
    expect(result.failure).toBeDefined();
    expect(result.failure?.errors[0]?.detail).toContain('must be a positive integer');
  });

  it('returns failure when value is a float', () => {
    const result = takeNumberOption(['--count', '1.5'], '--count');
    expect(result.failure).toBeDefined();
  });

  it('returns failure when value is negative', () => {
    const result = takeNumberOption(['--count', '-1'], '--count');
    expect(result.failure).toBeDefined();
  });

  it('returns no failure when option is absent', () => {
    const result = takeNumberOption(['foo', 'bar'], '--count');
    expect(result.failure).toBeUndefined();
    expect(result.value).toBeUndefined();
  });

  it('propagates failure from takeStringOption when no value given', () => {
    const result = takeNumberOption(['--count'], '--count');
    expect(result.failure).toBeDefined();
  });
});

describe('parseGlobalConfig', () => {
  it('uses DEFAULT_DAG_SERVER_URL when no --server-url and no env', () => {
    const config = parseGlobalConfig(['run', 'workflow.dag.json']);
    expect(config.serverUrl).toBeDefined();
    expect(config.failure).toBeUndefined();
    expect(config.args).toEqual(['run', 'workflow.dag.json']);
  });

  it('uses --server-url option when provided', () => {
    const config = parseGlobalConfig(['--server-url', 'http://custom:3000', 'run', 'dag.json']);
    expect(config.serverUrl).toBe('http://custom:3000');
    expect(config.args).toEqual(['run', 'dag.json']);
  });

  it('uses envServerUrl when no --server-url', () => {
    const config = parseGlobalConfig(['run'], 'http://from-env:8080');
    expect(config.serverUrl).toBe('http://from-env:8080');
  });

  it('prefers --server-url over envServerUrl', () => {
    const config = parseGlobalConfig(['--server-url', 'http://cli:9000'], 'http://from-env:8080');
    expect(config.serverUrl).toBe('http://cli:9000');
  });

  it('returns failure when --server-url has no value', () => {
    const config = parseGlobalConfig(['--server-url']);
    expect(config.failure).toBeDefined();
  });
});

describe('rejectUnexpectedArgs', () => {
  it('returns undefined when args is empty', () => {
    const result = rejectUnexpectedArgs([], 'myCommand');
    expect(result).toBeUndefined();
  });

  it('returns failure when unexpected args are present', () => {
    const result = rejectUnexpectedArgs(['unexpected', 'args'], 'myCommand');
    expect(result).toBeDefined();
    expect(result?.errors[0]?.detail).toContain('unexpected arguments');
    expect(result?.errors[0]?.detail).toContain('myCommand');
  });

  it('includes the unexpected args in the failure message', () => {
    const result = rejectUnexpectedArgs(['foo', 'bar'], 'cmd');
    expect(result?.errors[0]?.detail).toContain('foo');
    expect(result?.errors[0]?.detail).toContain('bar');
  });
});
