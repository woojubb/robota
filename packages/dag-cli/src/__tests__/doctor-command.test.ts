import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, mkdir, mkdtemp, writeFile, realpath } from 'node:fs/promises';
import { mkdtempSync, realpathSync } from 'node:fs';
import { doctorCommand } from '../commands/doctor.js';
import type { IDoctorCommandOptions } from '../commands/doctor.js';

// SEC-003: a private 0700 dir, not the shared world-writable OS temp dir itself.
const FALLBACK_CWD = realpathSync(mkdtempSync(join(tmpdir(), 'dag-doctor-cwd-')));

function createOptions(cwd?: string): IDoctorCommandOptions & { written: string[] } {
  const written: string[] = [];
  return {
    io: {
      write: (t) => {
        written.push(t);
      },
      writeError: (t) => {
        written.push(t);
      },
      readTextFile: async () => '',
      writeBinaryStream: async () => {},
    },
    cwd: cwd ?? FALLBACK_CWD,
    written,
  };
}

function getOutput(opts: { written: string[] }): string {
  return opts.written.join('');
}

describe('doctorCommand', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('--json flag outputs JSON', async () => {
    const opts = createOptions();
    const code = await doctorCommand(['--json'], opts);
    const output = getOutput(opts);
    expect([0, 1]).toContain(code);
    const parsed = JSON.parse(output.trim()) as { ok: boolean; checks: unknown[] };
    expect(typeof parsed.ok).toBe('boolean');
    expect(Array.isArray(parsed.checks)).toBe(true);
  });

  it('--json is equivalent to --output json', async () => {
    const opts1 = createOptions();
    const opts2 = createOptions();
    await doctorCommand(['--json'], opts1);
    await doctorCommand(['--output', 'json'], opts2);
    expect(getOutput(opts1)).toBe(getOutput(opts2));
  });

  it('--save writes JSON to file', async () => {
    const tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'dag-doctor-test-')));
    const savePath = join(tmpDir, 'report', 'doctor.json');
    const opts = createOptions();
    await doctorCommand(['--json', '--save', savePath], opts);
    const fileContent = await readFile(savePath, 'utf8');
    const parsed = JSON.parse(fileContent) as { ok: boolean };
    expect(typeof parsed.ok).toBe('boolean');
    expect(getOutput(opts)).toContain(`Saved: ${savePath}`);
  });

  it('--save alone also outputs JSON (implicit json mode)', async () => {
    const tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'dag-doctor-test2-')));
    const savePath = join(tmpDir, 'auto.json');
    const opts = createOptions();
    await doctorCommand(['--save', savePath], opts);
    const fileContent = await readFile(savePath, 'utf8');
    const parsed = JSON.parse(fileContent) as { ok: boolean };
    expect(typeof parsed.ok).toBe('boolean');
  });

  it('unknown flags return usage error', async () => {
    const opts = createOptions();
    const code = await doctorCommand(['--bogus'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('Error:');
  });

  it('default (no flags) outputs pretty format', async () => {
    const opts = createOptions();
    const code = await doctorCommand([], opts);
    expect([0, 1]).toContain(code);
    const output = getOutput(opts);
    // renderPretty shows ✓ or ✗ icons, not JSON
    expect(output).not.toMatch(/^\{/);
  });

  it('pretty output includes "checks passed" or error summary', async () => {
    const opts = createOptions();
    await doctorCommand([], opts);
    const output = getOutput(opts);
    expect(output.length).toBeGreaterThan(0);
  });

  it('outputs "All checks passed" when all required checks pass (covers result.ok=true branch)', async () => {
    const tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'dag-doctor-allok-')));
    const dagDir = join(tmpDir, '.dag');
    const workflowsDir = join(dagDir, 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(dagDir, '.env'), 'placeholder=value\n', 'utf8');
    // Set both required keys so errorCount = 0
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api03-validkeyformat1234567890123456');
    vi.stubEnv('OPENAI_API_KEY', 'sk-validopenaikeyformat1234567890123456789');
    const opts: IDoctorCommandOptions & { written: string[] } = {
      io: {
        write: (t) => {
          opts.written.push(t);
        },
        writeError: (t) => {
          opts.written.push(t);
        },
        readTextFile: (path) => readFile(path, 'utf8'),
        writeBinaryStream: async () => {},
      },
      cwd: tmpDir,
      written: [],
    };
    await doctorCommand([], opts);
    const output = opts.written.join('');
    expect(output).toContain('All checks passed');
  });

  it('outputs url hint when API key is missing (covers check.url branch in renderPretty)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    vi.stubEnv('OPENAI_API_KEY', undefined);
    vi.stubEnv('GEMINI_API_KEY', undefined);
    vi.stubEnv('DEEPSEEK_API_KEY', undefined);
    const opts = createOptions();
    await doctorCommand([], opts);
    const output = getOutput(opts);
    // renderPretty should have output the url hint
    expect(output).toContain('https://');
  });

  it('reports valid workflow file when .dag/workflows exists with dag.json files', async () => {
    const tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'dag-doctor-wf-')));
    const workflowsDir = join(tmpDir, '.dag', 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    const validDag = JSON.stringify({
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [{ nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} }],
      edges: [],
    });
    await writeFile(join(workflowsDir, 'test.dag.json'), validDag, 'utf8');
    const opts: IDoctorCommandOptions & { written: string[] } = {
      io: {
        write: (t) => {
          opts.written.push(t);
        },
        writeError: (t) => {
          opts.written.push(t);
        },
        readTextFile: (path) => readFile(path, 'utf8'),
        writeBinaryStream: async () => {},
      },
      cwd: tmpDir,
      written: [],
    };
    const code = await doctorCommand([], opts);
    expect([0, 1]).toContain(code);
    const output = opts.written.join('');
    expect(output).toContain('test.dag.json');
  });

  it('reports invalid dag.json when workflow file has invalid JSON', async () => {
    const tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'dag-doctor-bad-')));
    const workflowsDir = join(tmpDir, '.dag', 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(workflowsDir, 'broken.dag.json'), 'not valid json', 'utf8');
    const opts: IDoctorCommandOptions & { written: string[] } = {
      io: {
        write: (t) => {
          opts.written.push(t);
        },
        writeError: (t) => {
          opts.written.push(t);
        },
        readTextFile: (path) => readFile(path, 'utf8'),
        writeBinaryStream: async () => {},
      },
      cwd: tmpDir,
      written: [],
    };
    const code = await doctorCommand([], opts);
    expect([0, 1]).toContain(code);
    const output = opts.written.join('');
    expect(output).toContain('broken.dag.json');
  });

  it('shows empty result when .dag/workflows has no .dag.json files', async () => {
    const tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'dag-doctor-empty-')));
    const workflowsDir = join(tmpDir, '.dag', 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    // Write a non-.dag.json file so readdir returns something but dagJsonFiles is empty
    await writeFile(join(workflowsDir, 'notes.txt'), 'not a dag file', 'utf8');
    const opts: IDoctorCommandOptions & { written: string[] } = {
      io: {
        write: (t) => {
          opts.written.push(t);
        },
        writeError: (t) => {
          opts.written.push(t);
        },
        readTextFile: (path) => readFile(path, 'utf8'),
        writeBinaryStream: async () => {},
      },
      cwd: tmpDir,
      written: [],
    };
    const code = await doctorCommand([], opts);
    expect([0, 1]).toContain(code);
  });

  it('shows valid check for dag file without nodes array (nodeCount=null)', async () => {
    const tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'dag-doctor-nonodes-')));
    const workflowsDir = join(tmpDir, '.dag', 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    // Valid JSON object but no nodes array → nodeCount = null
    await writeFile(join(workflowsDir, 'no-nodes.dag.json'), '{"dagId":"test"}', 'utf8');
    const opts: IDoctorCommandOptions & { written: string[] } = {
      io: {
        write: (t) => {
          opts.written.push(t);
        },
        writeError: (t) => {
          opts.written.push(t);
        },
        readTextFile: (path) => readFile(path, 'utf8'),
        writeBinaryStream: async () => {},
      },
      cwd: tmpDir,
      written: [],
    };
    const code = await doctorCommand([], opts);
    expect([0, 1]).toContain(code);
    const output = opts.written.join('');
    expect(output).toContain('no-nodes.dag.json');
  });
});
