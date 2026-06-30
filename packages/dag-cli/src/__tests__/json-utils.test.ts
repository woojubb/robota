import { describe, it, expect, vi } from 'vitest';
import {
  formatJsonOutput,
  createCliFailure,
  parseJsonText,
  parseJsonArgument,
  parseJsonFile,
  isJsonObject,
} from '../json.js';
import type { IDagCliIo } from '../types.js';

function makeMockIo(fileContent = ''): IDagCliIo {
  return {
    write: vi.fn(),
    writeError: vi.fn(),
    readTextFile: vi.fn().mockResolvedValue(fileContent),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

describe('formatJsonOutput', () => {
  it('formats an IDagCliFailure as pretty-printed JSON with trailing newline', () => {
    const failure = createCliFailure('ERR', 'something went wrong');
    const result = formatJsonOutput(failure);
    expect(result).toContain('"ok": false');
    expect(result.endsWith('\n')).toBe(true);
  });

  it('formats a nested object with indentation', () => {
    const failure = createCliFailure('CODE', 'detail');
    const result = formatJsonOutput(failure);
    expect(result).toContain('  ');
  });
});

describe('createCliFailure', () => {
  it('returns a failure object with ok: false', () => {
    const failure = createCliFailure('MY_CODE', 'something went wrong');
    expect(failure.ok).toBe(false);
  });

  it('includes the error code in the type field', () => {
    const failure = createCliFailure('MY_CODE', 'detail text');
    expect(failure.errors[0]?.type).toContain('my_code');
  });

  it('includes the detail message', () => {
    const failure = createCliFailure('MY_CODE', 'detail text');
    expect(failure.errors[0]?.detail).toBe('detail text');
  });

  it('includes the code field', () => {
    const failure = createCliFailure('MY_CODE', 'detail text');
    expect(failure.errors[0]?.code).toBe('MY_CODE');
  });

  it('sets retryable to false', () => {
    const failure = createCliFailure('X', 'y');
    expect(failure.errors[0]?.retryable).toBe(false);
  });
});

describe('parseJsonText', () => {
  it('returns ok: true for valid JSON', () => {
    const result = parseJsonText('{"a":1}', 'test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1 });
    }
  });

  it('returns ok: false for invalid JSON', () => {
    const result = parseJsonText('not-json', 'test');
    expect(result.ok).toBe(false);
  });

  it('includes source in error message', () => {
    const result = parseJsonText('bad', 'my-source');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.errors[0]?.detail).toContain('my-source');
    }
  });

  it('parses arrays', () => {
    const result = parseJsonText('[1,2,3]', 'test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([1, 2, 3]);
    }
  });

  it('parses null', () => {
    const result = parseJsonText('null', 'test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('parses strings', () => {
    const result = parseJsonText('"hello"', 'test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('hello');
    }
  });

  it('parses numbers', () => {
    const result = parseJsonText('42', 'test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });
});

describe('parseJsonArgument', () => {
  it('parses inline JSON value', async () => {
    const io = makeMockIo();
    const result = await parseJsonArgument('{"key":"val"}', io);
    expect(result.ok).toBe(true);
  });

  it('returns error for invalid inline JSON', async () => {
    const io = makeMockIo();
    const result = await parseJsonArgument('not-json', io);
    expect(result.ok).toBe(false);
  });

  it('reads file when value starts with @', async () => {
    const io = makeMockIo('{"from":"file"}');
    const result = await parseJsonArgument('@/some/file.json', io);
    expect(result.ok).toBe(true);
    expect(io.readTextFile).toHaveBeenCalledWith('/some/file.json');
  });

  it('returns error when @ file cannot be read', async () => {
    const io = makeMockIo();
    vi.mocked(io.readTextFile).mockRejectedValueOnce(new Error('No such file'));
    const result = await parseJsonArgument('@/missing.json', io);
    expect(result.ok).toBe(false);
  });
});

describe('parseJsonFile', () => {
  it('reads and parses valid JSON file', async () => {
    const io = makeMockIo('{"data":true}');
    const result = await parseJsonFile('/some/file.json', io);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ data: true });
    }
  });

  it('returns error when file read fails (Error instance)', async () => {
    const io = makeMockIo();
    vi.mocked(io.readTextFile).mockRejectedValueOnce(new Error('File not found'));
    const result = await parseJsonFile('/missing.json', io);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.errors[0]?.detail).toContain('/missing.json');
    }
  });

  it('returns error when file read throws a non-Error value (covers String(err) branch)', async () => {
    // Throw a plain string (not an Error) to exercise the String(error) fallback in resolveErrorMessage
    const io = makeMockIo();
    vi.mocked(io.readTextFile).mockRejectedValueOnce('permission-denied-string');
    const result = await parseJsonFile('/missing.json', io);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.errors[0]?.detail).toContain('permission-denied-string');
    }
  });

  it('returns error when file content is invalid JSON', async () => {
    const io = makeMockIo('invalid-json');
    const result = await parseJsonFile('/bad.json', io);
    expect(result.ok).toBe(false);
  });
});

describe('isJsonObject', () => {
  it('returns true for plain objects', () => {
    expect(isJsonObject({ a: 1 })).toBe(true);
  });

  it('returns false for arrays', () => {
    expect(isJsonObject([1, 2])).toBe(false);
  });

  it('returns false for null', () => {
    expect(isJsonObject(null)).toBe(false);
  });

  it('returns false for strings', () => {
    expect(isJsonObject('hello')).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(isJsonObject(42)).toBe(false);
  });

  it('returns false for booleans', () => {
    expect(isJsonObject(true)).toBe(false);
  });

  it('returns true for empty object', () => {
    expect(isJsonObject({})).toBe(true);
  });
});
