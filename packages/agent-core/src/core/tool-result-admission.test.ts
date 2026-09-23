import { describe, expect, it, vi } from 'vitest';

import { ToolResultAdmissionError, admitToolResult } from './tool-result-admission.js';

describe('generic tool-result admission', () => {
  it('keeps a result within the configured limit without writing a spill', async () => {
    const write = vi.fn();
    const result = { success: true, data: { answer: 'okay' } };

    expect(
      await admitToolResult('example', result, {
        warningChars: 20,
        hardChars: 40,
        repositoryMaxChars: 100,
        spillStore: { write },
      }),
    ).toEqual(result);
    expect(write).not.toHaveBeenCalled();
  });

  it('reports only size and tool identity at the warning boundary', async () => {
    const onWarning = vi.fn();
    const result = { success: true, data: 'secret-output' };
    await admitToolResult('example', result, {
      warningChars: 12,
      hardChars: 20,
      repositoryMaxChars: 100,
      onWarning,
    });
    expect(onWarning).toHaveBeenCalledExactlyOnceWith({
      toolName: 'example',
      resultChars: 13,
      warningChars: 12,
    });
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain('secret-output');
  });

  it('replaces an oversized result only after the spill store commits its body', async () => {
    const raw = 'private-token='.padEnd(121, 'x');
    const reference = 'tool-result:abcdefghijklmnopqrstuv';
    const write = vi.fn().mockResolvedValue({ reference });
    const admitted = await admitToolResult(
      'example',
      { success: true, data: raw },
      { warningChars: 100, hardChars: 120, repositoryMaxChars: 200, spillStore: { write } },
    );

    expect(write).toHaveBeenCalledExactlyOnceWith(raw);
    expect(admitted).toEqual({ success: true, data: reference });
    expect(JSON.stringify(admitted)).not.toContain('private-token');
  });

  it('fails closed with a secret-free code if persistence is unavailable or fails', async () => {
    const raw = 'secret='.padEnd(130, 'x');
    const policy = { warningChars: 100, hardChars: 120, repositoryMaxChars: 200 };
    await expect(
      admitToolResult('example', { success: true, data: raw }, policy),
    ).rejects.toMatchObject({
      code: 'spill-unavailable',
    });
    await expect(
      admitToolResult(
        'example',
        { success: true, data: raw },
        {
          ...policy,
          spillStore: { write: async () => Promise.reject(new Error(raw)) },
        },
      ),
    ).rejects.toMatchObject({ code: 'spill-write-failed' });
    expect(new ToolResultAdmissionError('spill-write-failed').message).not.toContain('secret=');
  });

  it('caps a validated upward request at the configured repository maximum', async () => {
    const write = vi.fn().mockResolvedValue({ reference: 'tool-result:abcdefghijklmnopqrstuv' });
    const policy = {
      warningChars: 100,
      hardChars: 120,
      repositoryMaxChars: 150,
      spillStore: { write },
    };
    expect(
      await admitToolResult('example', { success: true, data: 'x'.repeat(140) }, policy, 180),
    ).toMatchObject({ data: 'x'.repeat(140) });
    expect(write).not.toHaveBeenCalled();
    await admitToolResult('example', { success: true, data: 'x'.repeat(151) }, policy, 180);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('keeps a host limit when a valid tool request is lower than it', async () => {
    const output = 'x'.repeat(90_000);
    const result = await admitToolResult(
      'example',
      { success: true, data: output },
      { warningChars: 10_000, hardChars: 100_000, repositoryMaxChars: 150_000 },
      50_000,
    );
    expect(result.data).toBe(output);
  });

  it('spills oversized tool failures without retaining their raw error or metadata', async () => {
    const reference = 'tool-result:abcdefghijklmnopqrstuv';
    const raw = 'authorization=private-error'.padEnd(130, 'x');
    const admitted = await admitToolResult(
      'example',
      { success: false, error: raw, metadata: { private: 'credential' } },
      {
        warningChars: 100,
        hardChars: 120,
        repositoryMaxChars: 200,
        spillStore: { write: async () => ({ reference }) },
      },
    );
    expect(admitted).toMatchObject({ success: false, error: `Tool failure details: ${reference}` });
    expect(JSON.stringify(admitted)).not.toContain('private-error');
    expect(JSON.stringify(admitted)).not.toContain('credential');
  });
});
