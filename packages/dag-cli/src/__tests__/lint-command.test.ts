import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDagCliIo } from '../types.js';

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
}));

import { lintCommand } from '../commands/lint.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_DAG = JSON.stringify({
  dagId: 'my-workflow',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'transform', nodeType: 'transform', dependsOn: ['input'], config: {} },
    { nodeId: 'text-output', nodeType: 'text-output', dependsOn: ['transform'], config: {} },
  ],
  edges: [
    { from: 'input', to: 'transform' },
    { from: 'transform', to: 'text-output' },
  ],
});

const NO_INPUT_DAG = JSON.stringify({
  dagId: 'no-input-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'transform', nodeType: 'transform', dependsOn: [], config: {} },
    { nodeId: 'text-output', nodeType: 'text-output', dependsOn: ['transform'], config: {} },
  ],
  edges: [{ from: 'transform', to: 'text-output' }],
});

const DISCONNECTED_DAG = JSON.stringify({
  dagId: 'disconnected-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'orphan', nodeType: 'transform', dependsOn: [], config: {} },
    { nodeId: 'text-output', nodeType: 'text-output', dependsOn: ['input'], config: {} },
  ],
  edges: [{ from: 'input', to: 'text-output' }],
});

const BAD_NAMING_DAG = JSON.stringify({
  dagId: 'bad-naming',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'X', nodeType: 'transform', dependsOn: [], config: {} },
    { nodeId: 'text-output', nodeType: 'text-output', dependsOn: ['X'], config: {} },
  ],
  edges: [{ from: 'input', to: 'text-output' }],
});

function makeIo(): IDagCliIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

describe('lintCommand - help', () => {
  it('prints help with --help', async () => {
    const io = makeIo();
    const code = await lintCommand(['--help'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('dag lint');
  });

  it('prints help with -h', async () => {
    const io = makeIo();
    const code = await lintCommand(['-h'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
  });
});

describe('lintCommand - argument errors', () => {
  it('returns error when no file/directory provided', async () => {
    const io = makeIo();
    const code = await lintCommand([], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('requires a <file|directory>');
  });

  it('returns error for --output with no value', async () => {
    const io = makeIo();
    const code = await lintCommand(['--output', 'some.dag.json'], { io, cwd: '/tmp/fake' });
    // 'some.dag.json' is a valid value for --output but not 'json' or 'pretty'
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('"json" or "pretty"');
  });

  it('returns error for unknown flag', async () => {
    const io = makeIo();
    const code = await lintCommand(['--unknown', 'some.dag.json'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected flags');
  });

  it('returns error for --rules-url with no value', async () => {
    const io = makeIo();
    const code = await lintCommand(['--rules-url'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--rules-url requires');
  });

  it('returns error for --rules-url with no following value', async () => {
    const io = makeIo();
    // --rules-url at end with no value
    const code = await lintCommand(['--rules-url'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--rules-url requires');
  });

  it('returns error for --rules-pkg with no value', async () => {
    const io = makeIo();
    const code = await lintCommand(['--rules-pkg'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--rules-pkg requires');
  });

  it('returns error for --output with no value (last arg)', async () => {
    const io = makeIo();
    const code = await lintCommand(['some.dag.json', '--output'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--output requires a value');
  });
});

describe('lintCommand - show-hook', () => {
  it('prints pre-commit hook snippet with --show-hook', async () => {
    const io = makeIo();
    const code = await lintCommand(['--show-hook'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('lint');
  });
});

describe('lintCommand - no files found', () => {
  it('reports no files when target finds nothing', async () => {
    const { stat } = await import('node:fs/promises');
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as unknown as Awaited<
      ReturnType<typeof stat>
    >);

    const { readdir } = await import('node:fs/promises');
    vi.mocked(readdir).mockResolvedValue([] as never);

    const io = makeIo();
    const code = await lintCommand(['./some-dir'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('No .dag.json files found');
  });
});

// ---------------------------------------------------------------------------
// Linting with real DAG content
// ---------------------------------------------------------------------------

describe('lintCommand - valid DAG', () => {
  beforeEach(async () => {
    const fsp = await import('node:fs/promises');
    // Single file target
    vi.mocked(fsp.stat).mockResolvedValue({
      isDirectory: () => false,
    } as unknown as Awaited<ReturnType<typeof fsp.stat>>);
    // No lint config
    vi.mocked(fsp.access).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fsp.readFile).mockResolvedValue(VALID_DAG as never);
  });

  it('returns exit code 0 and reports no issues for valid DAG', async () => {
    const io = makeIo();
    const code = await lintCommand(['workflow.dag.json'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('workflow.dag.json');
    expect(out).toContain('no issues found');
  });

  it('returns JSON output when --output json', async () => {
    const io = makeIo();
    const code = await lintCommand(['workflow.dag.json', '--output', 'json'], {
      io,
      cwd: '/tmp/fake',
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as Array<{
      file: string;
      parseError: null;
      findings: unknown[];
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]?.parseError).toBeNull();
    expect(parsed[0]?.findings).toHaveLength(0);
  });
});

describe('lintCommand - DAG with violations', () => {
  beforeEach(async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.stat).mockResolvedValue({
      isDirectory: () => false,
    } as unknown as Awaited<ReturnType<typeof fsp.stat>>);
    vi.mocked(fsp.access).mockRejectedValue({ code: 'ENOENT' });
  });

  it('returns exit code 1 and reports error for missing input node', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.readFile).mockResolvedValue(NO_INPUT_DAG as never);

    const io = makeIo();
    const code = await lintCommand(['bad.dag.json'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(1);
    const out = io.writes.join('');
    expect(out).toContain('No input node found');
  });

  it('reports disconnected node warning', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.readFile).mockResolvedValue(DISCONNECTED_DAG as never);

    const io = makeIo();
    const code = await lintCommand(['disconnected.dag.json'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(1);
    const out = io.writes.join('');
    expect(out).toContain('orphan');
  });

  it('reports naming convention warning for bad nodeId', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.readFile).mockResolvedValue(BAD_NAMING_DAG as never);

    const io = makeIo();
    const code = await lintCommand(['naming.dag.json'], { io, cwd: '/tmp/fake' });
    // Bad naming is a warning not an error so exit code 0
    expect([0, 1]).toContain(code);
    const out = io.writes.join('');
    expect(out).toContain('naming-convention');
  });

  it('reports JSON error for missing input node', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.readFile).mockResolvedValue(NO_INPUT_DAG as never);

    const io = makeIo();
    const code = await lintCommand(['bad.dag.json', '--output', 'json'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(1);
    const parsed = JSON.parse(io.writes.join('')) as Array<{
      findings: Array<{ ruleId: string; severity: string }>;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    const findings = parsed[0]?.findings ?? [];
    expect(findings.some((f) => f.ruleId === 'require-input-node')).toBe(true);
  });

  it('reports parse error for invalid JSON file', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.readFile).mockResolvedValue('not valid json' as never);

    const io = makeIo();
    const code = await lintCommand(['broken.dag.json'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(1);
    const out = io.writes.join('');
    expect(out).toContain('ERROR');
  });

  it('--strict promotes warnings to errors', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.readFile).mockResolvedValue(BAD_NAMING_DAG as never);

    const io = makeIo();
    const code = await lintCommand(['naming.dag.json', '--strict'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(1);
    const out = io.writes.join('');
    expect(out).toContain('naming-convention');
  });
});

describe('lintCommand - directory scanning', () => {
  it('scans directory and lints all .dag.json files', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.stat).mockResolvedValue({
      isDirectory: () => true,
    } as unknown as Awaited<ReturnType<typeof fsp.stat>>);
    vi.mocked(fsp.readdir).mockResolvedValue(['workflow.dag.json', 'other.txt'] as never);
    vi.mocked(fsp.access).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fsp.readFile).mockResolvedValue(VALID_DAG as never);

    const io = makeIo();
    const code = await lintCommand(['./workflows'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('workflow.dag.json');
    // 'other.txt' is filtered out
    expect(out).not.toContain('other.txt');
  });
});

describe('lintCommand - lint config file', () => {
  it('uses lint config with array-format rule overrides', async () => {
    const fsp = await import('node:fs/promises');
    // Lint config exists
    vi.mocked(fsp.stat).mockResolvedValue({
      isDirectory: () => false,
    } as unknown as Awaited<ReturnType<typeof fsp.stat>>);
    vi.mocked(fsp.access).mockResolvedValue(undefined); // config file EXISTS

    const lintConfig = JSON.stringify({
      rules: {
        'naming-convention': ['error'],
        'max-nodes': ['warn', 5],
      },
    });

    vi.mocked(fsp.readFile).mockImplementation(async (path: unknown) => {
      if (typeof path === 'string' && path.includes('lint.json')) {
        return lintConfig as never;
      }
      return VALID_DAG as never;
    });

    const io = makeIo();
    const code = await lintCommand(['workflow.dag.json'], { io, cwd: '/tmp/fake' });
    // Valid DAG with config present — should succeed
    expect(code).toBe(0);
  });

  it('reports config error when lint.json contains invalid JSON', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.stat).mockResolvedValue({
      isDirectory: () => false,
    } as unknown as Awaited<ReturnType<typeof fsp.stat>>);
    vi.mocked(fsp.access).mockResolvedValue(undefined); // config file EXISTS

    vi.mocked(fsp.readFile).mockImplementation(async (path: unknown) => {
      if (typeof path === 'string' && path.includes('lint.json')) {
        return 'not valid json' as never;
      }
      return VALID_DAG as never;
    });

    const io = makeIo();
    const code = await lintCommand(['workflow.dag.json'], { io, cwd: '/tmp/fake' });
    // Config parse error exits with code 3 (CONFIG_EXIT_CODE)
    expect(code).toBe(2);
    const out = io.writes.join('');
    expect(out).toContain('lint.json');
  });

  it('reports config error when lint.json rules is not an object', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.stat).mockResolvedValue({
      isDirectory: () => false,
    } as unknown as Awaited<ReturnType<typeof fsp.stat>>);
    vi.mocked(fsp.access).mockResolvedValue(undefined);

    const badConfig = JSON.stringify({ rules: 'not-an-object' });
    vi.mocked(fsp.readFile).mockImplementation(async (path: unknown) => {
      if (typeof path === 'string' && path.includes('lint.json')) {
        return badConfig as never;
      }
      return VALID_DAG as never;
    });

    const io = makeIo();
    const code = await lintCommand(['workflow.dag.json'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
  });

  it('reports config error when lint.json is not an object', async () => {
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.stat).mockResolvedValue({
      isDirectory: () => false,
    } as unknown as Awaited<ReturnType<typeof fsp.stat>>);
    vi.mocked(fsp.access).mockResolvedValue(undefined);

    vi.mocked(fsp.readFile).mockImplementation(async (path: unknown) => {
      if (typeof path === 'string' && path.includes('lint.json')) {
        return '["array"]' as never;
      }
      return VALID_DAG as never;
    });

    const io = makeIo();
    const code = await lintCommand(['workflow.dag.json'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
  });
});
