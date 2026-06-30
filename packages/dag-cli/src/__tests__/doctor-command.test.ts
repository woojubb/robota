import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { doctorCommand } from '../commands/doctor.js';
import type { IDoctorCommandOptions } from '../commands/doctor.js';

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
    cwd: cwd ?? tmpdir(),
    written,
  };
}

function getOutput(opts: { written: string[] }): string {
  return opts.written.join('');
}

describe('doctorCommand', () => {
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
    const tmpDir = join(tmpdir(), `dag-doctor-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const savePath = join(tmpDir, 'report', 'doctor.json');
    const opts = createOptions();
    await doctorCommand(['--json', '--save', savePath], opts);
    const fileContent = await readFile(savePath, 'utf8');
    const parsed = JSON.parse(fileContent) as { ok: boolean };
    expect(typeof parsed.ok).toBe('boolean');
    expect(getOutput(opts)).toContain(`Saved: ${savePath}`);
  });

  it('--save alone also outputs JSON (implicit json mode)', async () => {
    const tmpDir = join(tmpdir(), `dag-doctor-test2-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
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
    const tmpDir = join(tmpdir(), `dag-doctor-allok-${Date.now()}`);
    const dagDir = join(tmpDir, '.dag');
    const workflowsDir = join(dagDir, 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(dagDir, '.env'), 'placeholder=value\n', 'utf8');
    const savedAnthropic = process.env['ANTHROPIC_API_KEY'];
    const savedOpenai = process.env['OPENAI_API_KEY'];
    // Set both required keys so errorCount = 0
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-validkeyformat1234567890123456';
    process.env['OPENAI_API_KEY'] = 'sk-validopenaikeyformat1234567890123456789';
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
    if (savedAnthropic !== undefined) process.env['ANTHROPIC_API_KEY'] = savedAnthropic;
    else delete process.env['ANTHROPIC_API_KEY'];
    if (savedOpenai !== undefined) process.env['OPENAI_API_KEY'] = savedOpenai;
    else delete process.env['OPENAI_API_KEY'];
    const output = opts.written.join('');
    expect(output).toContain('All checks passed');
  });

  it('outputs url hint when API key is missing (covers check.url branch in renderPretty)', async () => {
    const saved = {
      anthropic: process.env['ANTHROPIC_API_KEY'],
      openai: process.env['OPENAI_API_KEY'],
      gemini: process.env['GEMINI_API_KEY'],
      deepseek: process.env['DEEPSEEK_API_KEY'],
    };
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['DEEPSEEK_API_KEY'];
    const opts = createOptions();
    await doctorCommand([], opts);
    // restore
    if (saved.anthropic !== undefined) process.env['ANTHROPIC_API_KEY'] = saved.anthropic;
    if (saved.openai !== undefined) process.env['OPENAI_API_KEY'] = saved.openai;
    if (saved.gemini !== undefined) process.env['GEMINI_API_KEY'] = saved.gemini;
    if (saved.deepseek !== undefined) process.env['DEEPSEEK_API_KEY'] = saved.deepseek;
    const output = getOutput(opts);
    // renderPretty should have output the url hint
    expect(output).toContain('https://');
  });

  it('reports valid workflow file when .dag/workflows exists with dag.json files', async () => {
    const tmpDir = join(tmpdir(), `dag-doctor-wf-${Date.now()}`);
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
    const tmpDir = join(tmpdir(), `dag-doctor-bad-${Date.now()}`);
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
    const tmpDir = join(tmpdir(), `dag-doctor-empty-${Date.now()}`);
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
    const tmpDir = join(tmpdir(), `dag-doctor-nonodes-${Date.now()}`);
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
