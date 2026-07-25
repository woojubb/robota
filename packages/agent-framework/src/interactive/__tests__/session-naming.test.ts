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

  it('preserves non-Latin (Korean) titles instead of destroying them', async () => {
    const provider = makeProvider('한국어 세션 제목');
    const name = await generateSessionName(provider, '한국어로 된 첫 메시지입니다');
    expect(name).toBe('한국어-세션-제목');
  });

  it('falls back to a sanitized Korean first message when the model returns nothing usable', async () => {
    const provider = makeProvider('');
    const name = await generateSessionName(provider, '로그인 버그 수정');
    expect(name).toBe('로그인-버그-수정');
  });

  it('strips punctuation but keeps letters and digits of any script', async () => {
    const provider = makeProvider('버그 수정: DB 연결!');
    const name = await generateSessionName(provider, 'fix db');
    expect(name).toBe('버그-수정-db-연결');
  });

  it('honors an injected naming system prompt', async () => {
    const provider = makeProvider('custom-title');
    await generateSessionName(provider, 'hello', { systemPrompt: 'CUSTOM NAMING PROMPT' });
    const messages = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toBe('CUSTOM NAMING PROMPT');
  });

  it('honors an injected sanitizer', async () => {
    const provider = makeProvider('Raw Title');
    const name = await generateSessionName(provider, 'hello', {
      sanitize: (raw) => raw.toUpperCase(),
    });
    expect(name).toBe('RAW TITLE');
  });
});
