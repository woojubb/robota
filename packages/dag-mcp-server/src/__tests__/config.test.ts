import { describe, expect, it } from 'vitest';
import { resolveDagMcpConfig } from '../config.js';

describe('resolveDagMcpConfig', () => {
  it('defaults to embedded mode when nothing is set', () => {
    const config = resolveDagMcpConfig([], {});
    expect(config.mode).toBe('embedded');
  });

  it('returns http mode when DAG_RUNTIME_SERVER_URL is set', () => {
    const config = resolveDagMcpConfig([], { DAG_RUNTIME_SERVER_URL: 'http://localhost:3939' });
    expect(config.mode).toBe('http');
    expect(config.serverUrl).toBe('http://localhost:3939');
  });

  it('returns http mode when --server-url flag is provided', () => {
    const config = resolveDagMcpConfig(['--server-url', 'http://custom:9999'], {});
    expect(config.mode).toBe('http');
    expect(config.serverUrl).toBe('http://custom:9999');
  });

  it('--server-url flag takes precedence over env var', () => {
    const config = resolveDagMcpConfig(['--server-url', 'http://flag:1111'], {
      DAG_RUNTIME_SERVER_URL: 'http://env:2222',
    });
    expect(config.mode).toBe('http');
    expect(config.serverUrl).toBe('http://flag:1111');
  });

  it('ignores empty DAG_RUNTIME_SERVER_URL and uses embedded mode', () => {
    const config = resolveDagMcpConfig([], { DAG_RUNTIME_SERVER_URL: '   ' });
    expect(config.mode).toBe('embedded');
  });
});
