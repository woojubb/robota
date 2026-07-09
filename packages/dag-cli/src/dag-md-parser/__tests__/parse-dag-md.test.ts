import { describe, it, expect } from 'vitest';
import { parseDagMd, DAG_MD_SUFFIX } from '../parse-dag-md.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDagMd(opts: {
  dagId?: string;
  meta?: string;
  nodes: string;
  mermaid?: string;
}): string {
  const dagId = opts.dagId ?? 'test-dag';
  const metaBlock = opts.meta ?? '';
  const mermaidBlock = opts.mermaid !== undefined ? `\`\`\`mermaid\n${opts.mermaid}\n\`\`\`` : '';

  return `---
dagId: ${dagId}
${metaBlock}dag:
  nodes:
${opts.nodes}
---

${mermaidBlock}
`.trim();
}

// ---------------------------------------------------------------------------
// DAG_MD_SUFFIX constant
// ---------------------------------------------------------------------------

describe('DAG_MD_SUFFIX', () => {
  it('equals .dag.md', () => {
    expect(DAG_MD_SUFFIX).toBe('.dag.md');
  });
});

// ---------------------------------------------------------------------------
// Frontmatter errors
// ---------------------------------------------------------------------------

describe('parseDagMd – frontmatter errors', () => {
  it('returns error when no frontmatter present', () => {
    const result = parseDagMd('# just a heading\nno frontmatter here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No YAML frontmatter/);
  });

  it('returns error when dagId is missing', () => {
    const text = `---
dag:
  nodes:
    n1:
      nodeType: input
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dagId/);
  });

  it('returns error when dag.nodes section is missing', () => {
    const text = `---
dagId: my-dag
dag:
  something: else
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dag\.nodes/);
  });

  it('returns error when dag section is missing entirely', () => {
    const text = `---
dagId: my-dag
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dag\.nodes/);
  });

  it('returns error when a node has no nodeType', () => {
    const text = `---
dagId: my-dag
dag:
  nodes:
    n1:
      config:
        foo: bar
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/"n1"/);
  });

  it('returns error when nodes map is empty', () => {
    const text = `---
dagId: my-dag
dag:
  nodes: {}
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one node/);
  });
});

// ---------------------------------------------------------------------------
// Minimal valid parse – single node, no edges
// ---------------------------------------------------------------------------

describe('parseDagMd – single node, no edges', () => {
  it('parses a minimal single-node DAG', () => {
    const text = `---
dagId: minimal-dag
dag:
  nodes:
    n1:
      nodeType: input
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dagId).toBe('minimal-dag');
    expect(result.definition.dagId).toBe('minimal-dag');
    expect(result.definition.version).toBe(1);
    expect(result.definition.status).toBe('draft');
    expect(result.definition.nodes).toHaveLength(1);
    expect(result.definition.nodes[0]).toMatchObject({
      nodeId: 'n1',
      nodeType: 'input',
      dependsOn: [],
    });
    expect(result.definition.edges).toHaveLength(0);
    expect(result.meta).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// type alias (type instead of nodeType)
// ---------------------------------------------------------------------------

describe('parseDagMd – type alias', () => {
  it('accepts "type" as alias for "nodeType"', () => {
    const text = `---
dagId: alias-dag
dag:
  nodes:
    n1:
      type: input
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes[0]?.nodeType).toBe('input');
  });
});

// ---------------------------------------------------------------------------
// Meta extraction
// ---------------------------------------------------------------------------

describe('parseDagMd – meta extraction', () => {
  it('extracts description, displayName, and tags', () => {
    const text = `---
dagId: meta-dag
meta:
  description: My workflow description
  displayName: My Workflow
  tags: [ai, pipeline]
dag:
  nodes:
    n1:
      nodeType: input
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.description).toBe('My workflow description');
    expect(result.meta.displayName).toBe('My Workflow');
    expect(result.meta.tags).toEqual(['ai', 'pipeline']);
  });

  it('meta fields are optional', () => {
    const text = `---
dagId: no-meta-dag
dag:
  nodes:
    n1:
      nodeType: input
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.description).toBeUndefined();
    expect(result.meta.displayName).toBeUndefined();
    expect(result.meta.tags).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Mermaid edge extraction and dependsOn
// ---------------------------------------------------------------------------

describe('parseDagMd – mermaid topology', () => {
  it('extracts edges and sets dependsOn from mermaid', () => {
    const text = `---
dagId: edge-dag
dag:
  nodes:
    n1:
      nodeType: input
    n2:
      nodeType: llm-text
    n3:
      nodeType: text-output
---

\`\`\`mermaid
flowchart LR
  n1 --> n2 --> n3
\`\`\`
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const n2 = result.definition.nodes.find((n) => n.nodeId === 'n2');
    const n3 = result.definition.nodes.find((n) => n.nodeId === 'n3');

    expect(n2?.dependsOn).toEqual(['n1']);
    expect(n3?.dependsOn).toEqual(['n2']);

    expect(result.definition.edges).toHaveLength(2);
    expect(result.definition.edges[0]).toMatchObject({ from: 'n1', to: 'n2' });
    expect(result.definition.edges[1]).toMatchObject({ from: 'n2', to: 'n3' });
  });

  it('defaults port bindings to text→text', () => {
    const text = `---
dagId: port-dag
dag:
  nodes:
    a:
      nodeType: input
    b:
      nodeType: text-output
---

\`\`\`mermaid
flowchart LR
  a --> b
\`\`\`
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.definition.edges[0]?.bindings).toEqual([{ outputKey: 'text', inputKey: 'text' }]);
  });

  it('respects fromPort and toPort overrides', () => {
    const text = `---
dagId: port-override-dag
dag:
  nodes:
    a:
      nodeType: input
      fromPort: result
    b:
      nodeType: text-output
      toPort: prompt
---

\`\`\`mermaid
flowchart LR
  a --> b
\`\`\`
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.definition.edges[0]?.bindings).toEqual([
      { outputKey: 'result', inputKey: 'prompt' },
    ]);
  });

  it('returns error when mermaid references undefined node', () => {
    const text = `---
dagId: ref-error-dag
dag:
  nodes:
    n1:
      nodeType: input
---

\`\`\`mermaid
flowchart LR
  n1 --> n2
\`\`\`
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/"n2"/);
  });

  it('handles mermaid node labels like A[Label] --> B[Other]', () => {
    const text = `---
dagId: label-dag
dag:
  nodes:
    A:
      nodeType: input
    B:
      nodeType: text-output
---

\`\`\`mermaid
flowchart LR
  A[Input Node] --> B[Output Node]
\`\`\`
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.edges).toHaveLength(1);
    expect(result.definition.edges[0]).toMatchObject({ from: 'A', to: 'B' });
  });

  it('parses DAG without mermaid block (no edges)', () => {
    const text = `---
dagId: no-mermaid-dag
dag:
  nodes:
    n1:
      nodeType: input
    n2:
      nodeType: text-output
---

Just documentation, no mermaid here.
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.edges).toHaveLength(0);
    expect(result.definition.nodes[0]?.dependsOn).toEqual([]);
    expect(result.definition.nodes[1]?.dependsOn).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Node config
// ---------------------------------------------------------------------------

describe('parseDagMd – node config', () => {
  it('parses inline config values', () => {
    const text = `---
dagId: config-dag
dag:
  nodes:
    n1:
      nodeType: llm-text
      config:
        model: gpt-4o
        temperature: 0.7
---
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const n1 = result.definition.nodes.find((n) => n.nodeId === 'n1');
    expect(n1?.config).toMatchObject({ model: 'gpt-4o', temperature: 0.7 });
  });
});

// ---------------------------------------------------------------------------
// Full end-to-end example
// ---------------------------------------------------------------------------

describe('parseDagMd – full example', () => {
  it('parses a realistic 3-node pipeline', () => {
    const text = `---
dagId: summarize-pipeline
meta:
  displayName: Summarize Article
  description: Fetches and summarizes a web article
  tags: [nlp, summarize]
dag:
  nodes:
    fetch:
      nodeType: http-fetch
    summarize:
      nodeType: llm-text
      config:
        model: claude-3-5-sonnet-20241022
    output:
      nodeType: text-output
---

## Summarize Pipeline

Fetches a URL and summarizes the content using Claude.

\`\`\`mermaid
flowchart LR
  fetch --> summarize --> output
\`\`\`
`;
    const result = parseDagMd(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dagId).toBe('summarize-pipeline');
    expect(result.meta.displayName).toBe('Summarize Article');
    expect(result.meta.tags).toEqual(['nlp', 'summarize']);
    expect(result.definition.nodes).toHaveLength(3);

    const summarize = result.definition.nodes.find((n) => n.nodeId === 'summarize');
    expect(summarize?.dependsOn).toEqual(['fetch']);
    expect(summarize?.config).toMatchObject({ model: 'claude-3-5-sonnet-20241022' });

    const output = result.definition.nodes.find((n) => n.nodeId === 'output');
    expect(output?.dependsOn).toEqual(['summarize']);

    expect(result.definition.edges).toHaveLength(2);
  });
});
