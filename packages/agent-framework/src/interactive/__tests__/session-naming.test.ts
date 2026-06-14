import { describe, it, expect, vi } from 'vitest';
import { generateSessionName } from '../session-naming.js';
import type { IAIProvider } from '@robota-sdk/agent-core';

function makeProvider(responseContent: string): IAIProvider {
  return {
    name: 'mock',
    version: '1.0.0',
    chat: vi.fn().mockResolvedValue({ role: 'assistant', content: responseContent }),
    generateResponse: vi.fn(),
    supportsTools: () => false,
  } as unknown as IAIProvider;
}

describe('generateSessionName', () => {
  it('returns sanitized name from provider response', async () => {
    const provider = makeProvider('refactor-auth-middleware');
    const name = await generateSessionName(provider, 'Refactor the auth middleware');
    expect(name).toBe('refactor-auth-middleware');
  });

  it('lowercases and strips special characters', async () => {
    const provider = makeProvider('Fix: Database Connection!');
    const name = await generateSessionName(provider, 'Fix database connection');
    expect(name).toBe('fix-database-connection');
  });

  it('collapses multiple spaces to single hyphen', async () => {
    const provider = makeProvider('write  api   docs');
    const name = await generateSessionName(provider, 'Write API docs');
    expect(name).toBe('write-api-docs');
  });

  it('falls back to sanitized first message when response is too short', async () => {
    const provider = makeProvider('ok');
    const name = await generateSessionName(provider, 'Fix login bug');
    expect(name).toBe('fix-login-bug');
  });

  it('truncates long names to 60 chars', async () => {
    const long = 'a'.repeat(100);
    const provider = makeProvider(long);
    const name = await generateSessionName(provider, 'something');
    expect(name.length).toBeLessThanOrEqual(60);
  });

  it('passes maxTokens: 20 to provider', async () => {
    const provider = makeProvider('short-name');
    await generateSessionName(provider, 'test');
    expect(provider.chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ maxTokens: 20 }),
    );
  });

  it('truncates first message to 200 chars before sending', async () => {
    const long = 'x'.repeat(500);
    const provider = makeProvider('short-name');
    await generateSessionName(provider, long);
    const messages = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMsg = messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content.length).toBeLessThanOrEqual(200);
  });
});
