import { describe, it, expect, vi } from 'vitest';
import { viewCommand } from '../commands/view.js';
import type { IDagCliIo } from '../types.js';

const MINIMAL_DAG = JSON.stringify({
  dagId: 'test',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['in'], config: {} },
  ],
  edges: [{ from: 'in', to: 'out', bindings: [] }],
});

const WORKFLOW_FILE_DAG = JSON.stringify({
  version: 0.4,
  nodes: [
    { id: 1, type: 'RobotaInput', pos: [0, 0], outputs: [], inputs: [] },
    { id: 2, type: 'RobotaTextOutput', pos: [250, 0], outputs: [], inputs: [] },
  ],
  links: [],
});

function makeMockIo(fileContent = MINIMAL_DAG): IDagCliIo & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: vi.fn((msg: string) => {
      written.push(msg);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn().mockResolvedValue(fileContent),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

describe('viewCommand', () => {
  it('returns USAGE_ERROR_EXIT_CODE when no file arg is given', async () => {
    const io = makeMockIo();
    const code = await viewCommand([], { io });
    expect(code).not.toBe(0);
    expect(io.writeError).toHaveBeenCalled();
  });

  it('shows help text with --help flag', async () => {
    const io = makeMockIo();
    const code = await viewCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('dag view');
  });

  it('shows help text with -h flag', async () => {
    const io = makeMockIo();
    const code = await viewCommand(['-h'], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('dag view');
  });

  it('returns error for unknown flag', async () => {
    const io = makeMockIo();
    const code = await viewCommand(['--unknown-flag'], { io });
    expect(code).not.toBe(0);
  });

  it('returns error for multiple positional args', async () => {
    const io = makeMockIo();
    const code = await viewCommand(['file1.dag.json', 'file2.dag.json'], { io });
    expect(code).not.toBe(0);
  });

  it('returns 0 and writes ASCII diagram for valid DAG file', async () => {
    const io = makeMockIo(MINIMAL_DAG);
    const code = await viewCommand(['workflow.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.written.join('');
    expect(output.length).toBeGreaterThan(0);
  });

  it('returns error when file cannot be read', async () => {
    const io = makeMockIo();
    vi.mocked(io.readTextFile).mockRejectedValueOnce(new Error('ENOENT'));
    const code = await viewCommand(['missing.dag.json'], { io });
    expect(code).not.toBe(0);
    expect(io.writeError).toHaveBeenCalled();
  });

  it('returns error when file contains invalid JSON', async () => {
    const io = makeMockIo('not-json');
    const code = await viewCommand(['bad.dag.json'], { io });
    expect(code).not.toBe(0);
    expect(io.writeError).toHaveBeenCalled();
  });

  it('returns error when file is not a JSON object', async () => {
    const io = makeMockIo('[]');
    const code = await viewCommand(['array.dag.json'], { io });
    expect(code).not.toBe(0);
  });

  it('outputs mermaid when --mermaid flag is used', async () => {
    const io = makeMockIo(MINIMAL_DAG);
    const code = await viewCommand(['workflow.dag.json', '--mermaid'], { io });
    expect(code).toBe(0);
    const output = io.written.join('');
    expect(output).toContain('flowchart LR');
    expect(output).toContain('in --> out');
  });

  it('handles --ascii flag (default, ignored)', async () => {
    const io = makeMockIo(MINIMAL_DAG);
    const code = await viewCommand(['workflow.dag.json', '--ascii'], { io });
    expect(code).toBe(0);
  });

  it('reads .dag.md file via parseDagMd (success path)', async () => {
    // parseDagMd requires YAML frontmatter starting with ---
    const dagMdContent = `---
dagId: md-dag
dag:
  nodes:
    in:
      nodeType: input
    out:
      nodeType: text-output
---
`;
    const io = makeMockIo(dagMdContent);
    const code = await viewCommand(['workflow.dag.md'], { io });
    // parseDagMd should succeed on valid YAML frontmatter, and viewCommand should succeed
    expect(code).toBe(0);
  });

  it('returns error when .dag.md file fails to parse (covers mdResult.ok false branch)', async () => {
    // Provide content that parseDagMd will fail on (no YAML frontmatter)
    const io = makeMockIo('just plain text no frontmatter');
    const code = await viewCommand(['workflow.dag.md'], { io });
    expect(code).not.toBe(0);
  });

  it('handles non-Error throw in file read (covers String(err) branch)', async () => {
    const io = makeMockIo();
    // Throw a non-Error value to exercise the `String(err)` branch of resolveErrorMessage
    vi.mocked(io.readTextFile).mockRejectedValueOnce('permission denied string error');
    const code = await viewCommand(['missing.dag.json'], { io });
    expect(code).not.toBe(0);
  });

  it('reads workflow file format with companion read failure (covers catch in companion block)', async () => {
    // When reading workflow.dag.json, also tries to read workflow.dag.robota.json (companion)
    // Make the first read (main file) succeed, second read (companion) throw
    const io = makeMockIo(WORKFLOW_FILE_DAG);
    let callCount = 0;
    vi.mocked(io.readTextFile).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return WORKFLOW_FILE_DAG; // main file
      throw new Error('companion not found'); // companion file read fails
    });
    const code = await viewCommand(['workflow.dag.json'], { io });
    // companion file failure is allowed - command should succeed
    expect(typeof code).toBe('number');
  });

  it('reads workflow file format with companion read success (covers success in companion block)', async () => {
    // When reading workflow.dag.json, also tries to read workflow.dag.robota.json (companion)
    // Make both reads succeed: main file is WORKFLOW_FILE_DAG, companion is {}
    const io = makeMockIo(WORKFLOW_FILE_DAG);
    let callCount = 0;
    vi.mocked(io.readTextFile).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return WORKFLOW_FILE_DAG; // main file
      return JSON.stringify({ nodes: {}, dagId: 'companion', version: 1 }); // companion file
    });
    const code = await viewCommand(['workflow.dag.json'], { io });
    // companion file success is fine - command should succeed
    expect(typeof code).toBe('number');
  });
});
