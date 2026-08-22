import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findRoutingSizeFindings,
  parseRoutingRule,
  readExaminedDocumentCount,
} from '../scan-routing-document-size.mjs';

const RULE = fileURLToPath(new URL('../../../.agents/rules/operational.md', import.meta.url));

const root = makeTemp('routing-size-');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const write = (rel, body) => {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

const ruleWith = (docs, target) =>
  [
    '### Document Size Rule',
    '',
    `- **Routing/index documents** — ${docs.map((d) => `\`${d}\``).join(', ')} — MUST stay lean ` +
      `(target under ${target} lines). They route to detail; they do not inline it.`,
    '',
  ].join('\n');

describe('routing-document-size — criteria are READ, never copied (D1)', () => {
  it('reads the document list and the target out of the rule that owns them', () => {
    const { documents, target } = parseRoutingRule(readFileSync(RULE, 'utf8'));

    expect(documents).toEqual([
      '.agents/rules/index.md',
      '.agents/project-structure.md',
      'AGENTS.md',
    ]);
    expect(target).toBe(80);
  });

  it('follows the rule when it names a different set — the list is not this file’s to hold', () => {
    // The point of deriving: adding a fourth routing document to the rule must govern it here with
    // no code change. A hard-coded list would silently keep measuring three.
    const { documents, target } = parseRoutingRule(ruleWith(['a.md', 'b.md', 'c.md', 'd.md'], 50));

    expect(documents).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
    expect(target).toBe(50);
  });

  it('fails closed when the rule states no such bullet', () => {
    expect(parseRoutingRule('### Something Else\n\n- unrelated\n')).toEqual({
      documents: [],
      target: undefined,
    });
  });

  it('throws rather than passing when the parsed criteria are empty', () => {
    write('.agents/rules/operational.md', '### Document Size Rule\n\n- nothing parseable\n');

    expect(() => findRoutingSizeFindings(root)).toThrow(/unreadable/);
  });
});

describe('routing-document-size — the ratchet (D1)', () => {
  const lines = (n) => `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')}\n`;

  it('passes at the frozen size and fails one line above it', () => {
    write('.agents/rules/operational.md', ruleWith(['DOC.md'], 80));
    write('DOC.md', lines(10));

    expect(findRoutingSizeFindings(root, { 'DOC.md': 10 }).findings).toEqual([]);

    // Red proof: the ratchet is worth nothing unless growth is what trips it.
    const grown = findRoutingSizeFindings(root, { 'DOC.md': 9 });

    expect(grown.findings).toHaveLength(1);
    expect(grown.findings[0].problem).toMatch(/10 lines, above its frozen 9/);
  });

  it('passes when a document shrinks below its frozen size — the ratchet only tightens', () => {
    expect(findRoutingSizeFindings(root, { 'DOC.md': 40 }).findings).toEqual([]);
  });

  it('reports the gap to the target without enforcing it', () => {
    // Enforcing 80 today would mean deleting routing rows, which is what a routing document is for.
    // The gap is measured so it stays visible; only the direction is enforced.
    const { measured, target } = findRoutingSizeFindings(root, { 'DOC.md': 10 });

    expect(measured['DOC.md']).toBe(10);
    expect(target).toBe(80);
  });

  it('flags a document the rule names that does not exist', () => {
    write('.agents/rules/operational.md', ruleWith(['DOC.md', 'GONE.md'], 80));

    const { findings } = findRoutingSizeFindings(root, {});

    expect(findings).toHaveLength(1);
    expect(findings[0].document).toBe('GONE.md');
    expect(findings[0].problem).toMatch(/does not exist/);
  });

  it('reports the size it examined, and does not accumulate across runs', () => {
    findRoutingSizeFindings(root, {});

    expect(readExaminedDocumentCount(root)).toBe(2);

    findRoutingSizeFindings(root, {});

    expect(readExaminedDocumentCount(root)).toBe(2);
  });

  it('fails closed when the rule document is absent entirely', () => {
    const empty = makeTemp('routing-size-empty-');

    expect(() => findRoutingSizeFindings(empty)).toThrow(/missing from/);

    rmSync(empty, { recursive: true, force: true });
  });
});

describe('routing-document-size — this repository (D1)', () => {
  it('passes against the frozen baseline', () => {
    const { findings, examined } = findRoutingSizeFindings();

    expect(findings).toEqual([]);
    expect(examined).toBe(3);
  });
});
