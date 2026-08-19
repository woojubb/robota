import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assignedKeys,
  declaredKeys,
  findUnreachableOptions,
} from '../scan-option-reachability.mjs';

/**
 * The scan exists because two documented capabilities shipped that no surface could turn on:
 * `ICreateSessionOptions.guardrails` (SELFHOST-005) and `.retrievalAdapter` (SELFHOST-003) are read
 * at the consuming end and set by no production call to `createSession`.
 *
 * What matters most here is the second direction. The first version of this scan matched property
 * names anywhere in the tree and found **1** of the 12 keys that are genuinely unreachable, because
 * `guardrails` also names a key of an unrelated zod schema. A check that reports a clean result over
 * ground it never covered is the exact defect this repository keeps meeting, so several cases below
 * pin the narrowing rather than the finding.
 */
const CONSTRUCTORS = ['createSession'];

function assigned(source) {
  return assignedKeys(source, 'f.ts', CONSTRUCTORS);
}

describe('scan-option-reachability', () => {
  describe('declared keys', () => {
    it('reads the properties of the named interface', () => {
      const keys = declaredKeys(`export interface IFoo { a?: string; b: number; }`, 'f.ts', 'IFoo');
      expect(keys).toEqual(['a', 'b']);
    });

    it('returns null when the interface is absent, rather than an empty list', () => {
      // An empty list would read as "this interface declares nothing", and every key would look
      // reachable. Absence is an error the caller must raise, not a pass.
      expect(declaredKeys(`export interface IBar { a?: string }`, 'f.ts', 'IFoo')).toBeNull();
    });

    it('ignores members that are not properties', () => {
      const keys = declaredKeys(`interface IFoo { a?: string; run(): void; }`, 'f.ts', 'IFoo');
      expect(keys).toEqual(['a']);
    });
  });

  describe('assignment, scoped to the constructor', () => {
    it('counts a key set on the constructor argument', () => {
      expect([...assigned(`createSession({ guardrails: g, model: m });`)]).toEqual([
        'guardrails',
        'model',
      ]);
    });

    it('counts a shorthand property', () => {
      expect([...assigned(`createSession({ effort });`)]).toEqual(['effort']);
    });

    it('descends into a CONDITIONAL SPREAD — how this repo writes an optional field', () => {
      const source = `createSession({ ...(x !== undefined ? { effort: x } : {}) });`;
      expect([...assigned(source)]).toEqual(['effort']);
    });

    it('descends into a && spread', () => {
      expect([...assigned(`createSession({ ...(x && { effort: x }) });`)]).toEqual(['effort']);
    });

    it('does NOT count the same key set on an unrelated object', () => {
      // The whole reason the name-only version was useless: `guardrails` also names a key of a zod
      // schema in this repository, so matching anywhere found 1 of 12 real gaps.
      expect([...assigned(`const schema = { guardrails: z.array(z.string()) };`)]).toEqual([]);
    });

    it('does NOT count a READ of the key', () => {
      // The defect is a field read everywhere and written nowhere; treating a read as a write would
      // make every consumed-but-unset option look fine — which is precisely the bug.
      expect([...assigned(`if (options.guardrails) run(options.guardrails);`)]).toEqual([]);
    });

    it('counts a PRODUCER — a function declaring it returns the interface', () => {
      // Extracting an options literal into a named builder is this repository's own remedy for a
      // projection buried in an implementation file. Without this branch the scan reported all 39
      // assigned keys as unreachable the moment that extraction happened — measured, not imagined.
      const source = `function build(): ICreateSessionOptions { return { guardrails: g }; }`;
      const found = assignedKeys(
        source,
        'f.ts',
        CONSTRUCTORS,
        new Set(),
        [],
        'ICreateSessionOptions',
      );
      expect([...found]).toEqual(['guardrails']);
    });

    it('does not count a producer returning a DIFFERENT interface', () => {
      const source = `function build(): ISomethingElse { return { guardrails: g }; }`;
      const found = assignedKeys(
        source,
        'f.ts',
        CONSTRUCTORS,
        new Set(),
        [],
        'ICreateSessionOptions',
      );
      expect([...found]).toEqual([]);
    });

    it('does not count a call to a DIFFERENT function', () => {
      expect([...assigned(`buildSomethingElse({ guardrails: g });`)]).toEqual([]);
    });

    it('reports a spread it cannot read rather than assuming it empty', () => {
      // `...base` may carry any key. Assuming it carries none over-reports; assuming it carries all
      // under-reports. Both are silent. Saying so is the only honest option.
      const opaque = [];
      assignedKeys(
        `createSession({ ...base, model: m });`,
        'f.ts',
        CONSTRUCTORS,
        new Set(),
        opaque,
      );
      expect(opaque).toEqual(['base']);
    });
  });

  describe('fail-closed', () => {
    it('throws when the declaring file is absent', () => {
      const bare = mkdtempSync(path.join(tmpdir(), 'option-reach-'));
      try {
        expect(() =>
          findUnreachableOptions(bare, [
            { name: 'IFoo', file: 'nope/types.ts', constructors: ['x'] },
          ]),
        ).toThrow(/does not exist/);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });

    it('fails closed the way the GUARD calls it — with a root and nothing else', () => {
      // The guard-scope floor invokes every finder as `finder(bare)`. Without a default for
      // `configs` that threw `TypeError: Cannot read properties of undefined`, which still counts as
      // "threw" and so still satisfied the floor — while the behaviour recorded beside the
      // classification was not the behaviour that fired. Caught in review; the original measurement
      // had been taken with two arguments.
      const bare = mkdtempSync(path.join(tmpdir(), 'option-reach-guard-'));
      try {
        expect(() => findUnreachableOptions(bare)).toThrow(/does not exist/);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });

    it('throws when the interface is not found in its declaring file', () => {
      // A renamed interface is a stale config, not a clean tree.
      const root = path.resolve(import.meta.dirname, '../../..');
      expect(() =>
        findUnreachableOptions(root, [
          {
            name: 'INoSuchInterfaceAnywhere',
            file: 'packages/agent-framework/src/assembly/create-session-types.ts',
            constructors: ['createSession'],
          },
        ]),
      ).toThrow(/was not found/);
    });
  });

  /**
   * The registered path and the live number. A ratchet nobody invokes, or whose frozen number came
   * from somewhere nobody can explain, is not a ratchet.
   */
  it('is registered, passes on the live repository, and its baseline matches what it counts', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    expect(readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8')).toContain(
      'scan-option-reachability.mjs',
    );

    const output = execFileSync('node', ['scripts/harness/scan-option-reachability.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    const examined = Number(/(\d+) production file/.exec(output)?.[1] ?? '0');
    // A pass over nothing is not a pass.
    expect(examined).toBeGreaterThan(500);

    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/option-reachability-baseline.json'), 'utf8'),
    );
    const reported = Number(/(\d+) key\(s\) unreachable/.exec(output)?.[1] ?? '-1');
    expect(reported).toBe(Object.values(frozen).flat().length);
  });

  it('the three capabilities this scan was built for are all WIRED, not baselined', () => {
    // This case used to pin `guardrails` and `retrievalAdapter` INTO the frozen set, because stage 1
    // wired only `effort` and the other two were still unreachable. Its comment said a future change
    // that dropped them from the baseline "rather than wiring them" would have to explain itself.
    //
    // ARCH-013 stage 3 is that change, and it wired them: both are now forwarded through
    // `initializeInteractiveSessionAsync` and projected in `buildCreateSessionOptions`, with the
    // chain red-proved from the published surface. So the assertion is inverted rather than deleted —
    // the scan's subject is unchanged, and what it now pins is that none of the three may return.
    const root = path.resolve(import.meta.dirname, '../../..');
    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/option-reachability-baseline.json'), 'utf8'),
    );
    for (const wired of ['effort', 'guardrails', 'retrievalAdapter']) {
      expect(
        frozen['ICreateSessionOptions'],
        `${wired} regressed into the frozen set`,
      ).not.toContain(wired);
    }
    // The set is not empty — nine keys remain unreachable, and an empty baseline would make the
    // assertion above pass for the wrong reason.
    expect(frozen['ICreateSessionOptions'].length).toBeGreaterThan(0);
  });
});
