import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

import { benchmarkCommand } from '../commands/benchmark.js';
import { decodeDagInput } from '../commands/decode-dag-input.js';
import { runCostCommand } from '../commands/cost.js';
import { explainCommand } from '../commands/explain.js';
import { fixCommand } from '../commands/fix.js';
import { runCommand } from '../commands/run.js';
import { viewCommand } from '../commands/view.js';

import type { IDagCliIo } from '../types.js';

const MALFORMED_NESTED = JSON.stringify({
  dagId: 'malformed',
  version: 1,
  status: 'draft',
  nodes: [{ nodeId: 42, nodeType: 'input', dependsOn: [], config: {} }],
  edges: [],
});

const INVALID_STATUS = JSON.stringify({
  dagId: 'import-boundary',
  version: 1,
  status: 'active',
  nodes: [],
  edges: [],
});

function ioFor(contents: string): IDagCliIo & { readonly output: string[] } {
  const output: string[] = [];
  return {
    output,
    write: (text) => output.push(text),
    writeError: (text) => output.push(text),
    readTextFile: async () => contents,
    writeBinaryStream: async () => {},
  };
}

const FILE = 'invalid.dag.json';
const commandReaders = [
  {
    name: 'run file',
    invoke: (io: IDagCliIo) => runCommand([FILE, '--dry-run'], { io }),
  },
  { name: 'view', invoke: (io: IDagCliIo) => viewCommand([FILE], { io }) },
  {
    name: 'cost',
    invoke: (io: IDagCliIo) => runCostCommand(['estimate', FILE], { io }),
  },
  {
    name: 'explain',
    invoke: (io: IDagCliIo) => explainCommand([FILE], { io }),
  },
  {
    name: 'benchmark',
    invoke: (io: IDagCliIo) => benchmarkCommand([FILE], { io }),
  },
  {
    name: 'fix',
    invoke: (io: IDagCliIo) => fixCommand([FILE, '--no-llm'], { io }),
  },
];

describe('DAG-004 command import boundary', () => {
  it('decodes both supported disk formats and rejects an unknown shape', () => {
    expect(decodeDagInput({ dagId: 'd', version: 1, nodes: [] }).ok).toBe(true);
    expect(
      decodeDagInput({
        version: 0.4,
        last_node_id: 0,
        last_link_id: 0,
        nodes: [],
        links: [],
      }).ok,
    ).toBe(true);
    const unknown = decodeDagInput({ something: 'else' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toContain('Not a DAG file');
  });

  for (const { name, invoke } of commandReaders) {
    it(`${name} refuses a parseable but invalid status before execution`, async () => {
      const io = ioFor(INVALID_STATUS);
      const code = await invoke(io);
      expect(code).not.toBe(0);
      expect(io.output.join('')).toMatch(/status|active/i);
    });
  }

  for (const { name, invoke } of commandReaders) {
    it(`${name} reports the nested field path instead of a TypeError`, async () => {
      const io = ioFor(MALFORMED_NESTED);
      const code = await invoke(io);
      expect(code).not.toBe(0);
      expect(io.output.join('')).toMatch(/nodes\[0\].*nodeId/);
    });
  }

  for (const { name, invoke } of commandReaders) {
    it(`${name} rejects an unknown JSON object shape`, async () => {
      const io = ioFor('{"something":"else"}');
      const code = await invoke(io);
      expect(code).not.toBe(0);
      expect(io.output.join('')).toContain('Not a DAG file');
    });
  }

  it('run stdin rejects invalid status after stripping comment lines', async () => {
    vi.stubGlobal(
      'process',
      Object.create(process, {
        stdin: { value: Readable.from([Buffer.from(`# generated DAG\n${INVALID_STATUS}`)]) },
      }),
    );
    try {
      const io = ioFor('');
      const code = await runCommand(['--stdin', '--dry-run'], { io });
      expect(code).not.toBe(0);
      expect(io.output.join('')).toMatch(/status|active/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('run stdin rejects an unknown JSON object shape', async () => {
    vi.stubGlobal(
      'process',
      Object.create(process, {
        stdin: { value: Readable.from([Buffer.from('{"something":"else"}')]) },
      }),
    );
    try {
      const io = ioFor('');
      expect(await runCommand(['--stdin', '--dry-run'], { io })).not.toBe(0);
      expect(io.output.join('')).toContain('Not a DAG file');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('run URL uses the same decoder before execution', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => INVALID_STATUS }),
    );
    try {
      const io = ioFor(INVALID_STATUS);
      const code = await runCommand(['https://example.invalid/workflow.dag.json', '--dry-run'], {
        io,
      });
      expect(code).not.toBe(0);
      expect(io.output.join('')).toMatch(/status|active/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('run URL rejects an unknown JSON object shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => '{"something":"else"}' }),
    );
    try {
      const io = ioFor('');
      expect(
        await runCommand(['https://example.invalid/unknown.dag.json', '--dry-run'], { io }),
      ).not.toBe(0);
      expect(io.output.join('')).toContain('Not a DAG file');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
