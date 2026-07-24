import { describe, expect, it } from 'vitest';

import {
  evaluatePromptProse,
  evaluateRoleVocabulary,
  extractSinkLiterals,
  fingerprintLiteral,
  isPromptProse,
  parseStringLiteral,
} from '../scan-prompt-prose.mjs';

/**
 * NEUT-006 — the prompt-prose neutrality RATCHET (audit 2026-07-24 gap #6). These tests lock in
 * the enforcing semantics on the exported pure evaluator: new model-facing instruction prose in a
 * non-baselined library file FAILS; baselined files are FROZEN at their literal fingerprints;
 * shrinking tightens; role-vocabulary + concrete-model-id bindings are confined to the chartered
 * defaults package.
 */

const PROSE = {
  minWords: 8,
  markerPattern:
    "\\b(?:you|your|never|always|must|should|do not|don't|use this|important|prefer|avoid|instead)\\b",
};

const SINKS = [
  '\\bdescription\\s*:\\s*',
  '\\.describe\\s*\\(\\s*',
  '(?:export\\s+)?(?:const|let)\\s+[A-Za-z_$][\\w$]*(?:[Pp]rompt|PROMPT)[\\w$]*\\s*(?::\\s*string)?\\s*=\\s*',
  '\\b(?:systemPrompt|systemMessage)\\s*:\\s*',
];

const IMPERATIVE_LONG =
  'You must NEVER create documentation files unless the user explicitly requests them first.';
const NEUTRAL_LONG =
  'Returns the parsed configuration object for the current workspace root directory entry.';

describe('parseStringLiteral', () => {
  it('parses single-, double-, and backtick-quoted literals', () => {
    expect(parseStringLiteral("'abc'", 0)?.text).toBe('abc');
    expect(parseStringLiteral('"abc"', 0)?.text).toBe('abc');
    expect(parseStringLiteral('`abc`', 0)?.text).toBe('abc');
  });

  it('decodes escapes and treats escaped newlines/tabs as whitespace', () => {
    expect(parseStringLiteral("'a\\nb\\tc'", 0)?.text).toBe('a b c');
    expect(parseStringLiteral("'don\\'t'", 0)?.text).toBe("don't");
  });

  it('spans real newlines inside template literals and blanks interpolations', () => {
    const src = '`line one\nuse ${toolName} now`';
    expect(parseStringLiteral(src, 0)?.text).toBe('line one\nuse   now');
  });

  it('rejects unterminated or non-literal starts', () => {
    expect(parseStringLiteral("'abc", 0)).toBeUndefined();
    expect(parseStringLiteral('notAQuote', 0)).toBeUndefined();
    expect(parseStringLiteral("'a\nb'", 0)).toBeUndefined(); // raw newline in a '-string
  });
});

describe('extractSinkLiterals', () => {
  it('extracts literals from description properties, prompt-named consts, and prompt properties', () => {
    const src = [
      "const tool = { description: 'Reads a file from disk' };",
      'const SYSTEM_PROMPT = `You are a helper.`;',
      "const cfg = { systemPrompt: 'Be terse.' };",
      "schema.describe('The absolute path to read')",
    ].join('\n');
    const texts = extractSinkLiterals(
      src,
      SINKS.map((p) => new RegExp(p, 'g')),
    ).map((l) => l.text);
    expect(texts).toEqual([
      'Reads a file from disk',
      'You are a helper.',
      'Be terse.',
      'The absolute path to read',
    ]);
  });

  it('captures every element of a returned literal ARRAY (the [...].join prompt-builder shape)', () => {
    const src = [
      'function buildToolDescription() {',
      '  return [',
      '    `Executes a command in the host shell.`,',
      '    ``,',
      "    'IMPORTANT: you must avoid running find or grep through this tool.',",
      '  ].join(String.fromCharCode(10));',
      '}',
    ].join('\n');
    const sinks = [/\breturn\s*(?=['"`[])/g];
    const texts = extractSinkLiterals(src, sinks).map((l) => l.text);
    expect(texts).toEqual([
      'Executes a command in the host shell.',
      '',
      'IMPORTANT: you must avoid running find or grep through this tool.',
    ]);
  });

  it('ignores sinks whose value is not a string literal', () => {
    const src = 'const x = { description: buildDescription(), systemPrompt: myVar };';
    expect(
      extractSinkLiterals(
        src,
        SINKS.map((p) => new RegExp(p, 'g')),
      ),
    ).toEqual([]);
  });

  it('does not double-count a literal matched by two sink patterns', () => {
    const src = "const FOO_PROMPT = 'You are a careful reviewer of things.';";
    const sinks = [/(?:const|let)\s+[A-Z_]*PROMPT[\w$]*\s*=\s*/g, /PROMPT[\w$]*\s*=\s*/g];
    expect(extractSinkLiterals(src, sinks)).toHaveLength(1);
  });
});

describe('isPromptProse', () => {
  it('accepts long imperative instruction text', () => {
    expect(isPromptProse(IMPERATIVE_LONG, PROSE)).toBe(true);
  });

  it('rejects short literals even with imperative markers', () => {
    expect(isPromptProse('You must not.', PROSE)).toBe(false);
  });

  it('rejects long literals without imperative markers', () => {
    expect(isPromptProse(NEUTRAL_LONG, PROSE)).toBe(false);
  });

  it('rejects markup/code-scaffold payloads via nonProsePatterns', () => {
    const cfg = { ...PROSE, nonProsePatterns: ['^\\s*<', '^\\s*import\\s'] };
    expect(
      isPromptProse('<html><body>You must always enable scripts to view this page</body>', cfg),
    ).toBe(false);
    expect(
      isPromptProse('import type { Thing } from "./x"; // you must register your node here', cfg),
    ).toBe(false);
    expect(isPromptProse(IMPERATIVE_LONG, cfg)).toBe(true);
  });
});

describe('fingerprintLiteral', () => {
  it('is whitespace-normalization stable', () => {
    expect(fingerprintLiteral('You  must\n never   do this')).toBe(
      fingerprintLiteral('You must never do this'),
    );
  });

  it('differs for different prose', () => {
    expect(fingerprintLiteral('alpha')).not.toBe(fingerprintLiteral('beta'));
  });
});

describe('evaluatePromptProse ratchet (NEUT-006)', () => {
  const lit = (text) => ({ hash: fingerprintLiteral(text), preview: text.slice(0, 70) });

  it('NEW prose in a non-baselined library file fails', () => {
    const { findings } = evaluatePromptProse(
      [{ relPath: 'packages/agent-core/src/thing.ts', literals: [lit(IMPERATIVE_LONG)] }],
      {},
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('new-prose-in-library-file');
    expect(findings[0].file).toBe('packages/agent-core/src/thing.ts');
  });

  it('a baselined file with IDENTICAL prose fingerprints passes (debt frozen, not licensed)', () => {
    const entry = { relPath: 'packages/x/src/legacy.ts', literals: [lit(IMPERATIVE_LONG)] };
    const baseline = {
      'packages/x/src/legacy.ts': { count: 1, hashes: [fingerprintLiteral(IMPERATIVE_LONG)] },
    };
    const { findings, tightenable } = evaluatePromptProse([entry], baseline);
    expect(findings).toHaveLength(0);
    expect(tightenable).toEqual([]);
  });

  it('prose ADDED to (or edited in) a baselined file fails', () => {
    const baseline = {
      'packages/x/src/legacy.ts': { count: 1, hashes: [fingerprintLiteral(IMPERATIVE_LONG)] },
    };
    const { findings } = evaluatePromptProse(
      [
        {
          relPath: 'packages/x/src/legacy.ts',
          literals: [
            lit(IMPERATIVE_LONG),
            lit('You should always prefer the other tool for this whole class of work.'),
          ],
        },
      ],
      baseline,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('prose-past-baseline');
  });

  it('a baselined file that DROPPED a prose literal is tightenable, not a finding', () => {
    const baseline = {
      'packages/x/src/legacy.ts': {
        count: 2,
        hashes: [
          fingerprintLiteral(IMPERATIVE_LONG),
          fingerprintLiteral('You must always run the verification suite before you claim done.'),
        ],
      },
    };
    const { findings, tightenable } = evaluatePromptProse(
      [{ relPath: 'packages/x/src/legacy.ts', literals: [lit(IMPERATIVE_LONG)] }],
      baseline,
    );
    expect(findings).toHaveLength(0);
    expect(tightenable).toEqual(['packages/x/src/legacy.ts']);
  });

  it('a baselined file with no remaining prose (or deleted) is reported stale', () => {
    const { stale } = evaluatePromptProse([], {
      'packages/x/src/gone.ts': { count: 1, hashes: ['abc'] },
    });
    expect(stale).toEqual(['packages/x/src/gone.ts']);
  });
});

describe('evaluateRoleVocabulary (audit role-vocab assertion)', () => {
  const CFG = {
    roleTermPattern: '[\'"`](?:planner|editor|reviewer)[\'"`]|\\b(?:planner|editor|reviewer)\\s*:',
    modelIdPatterns: ['\\bclaude-[a-z0-9][a-z0-9.-]*\\b', '\\bgpt-[0-9][a-z0-9.-]*\\b'],
    allowedPathIncludes: ['packages/agent-provider-defaults/'],
  };

  it('flags a role name bound alongside a concrete model id outside the defaults package', () => {
    const findings = evaluateRoleVocabulary(
      [
        {
          relPath: 'packages/agent-core/src/routing.ts',
          content: "const map = { planner: { model: 'claude-opus-4-5' } };",
        },
      ],
      CFG,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('role-model-binding-outside-defaults');
  });

  it('allows the binding inside the chartered defaults package', () => {
    const findings = evaluateRoleVocabulary(
      [
        {
          relPath: 'packages/agent-provider-defaults/src/default-role-models.ts',
          content: "planner: [{ provider: 'anthropic', model: 'claude-opus-4-5' }]",
        },
      ],
      CFG,
    );
    expect(findings).toHaveLength(0);
  });

  it('a role term alone, or a model id alone, is not a finding', () => {
    const findings = evaluateRoleVocabulary(
      [
        {
          relPath: 'packages/agent-command/src/editor/editor-command.ts',
          content: "registerCommand('editor', openEditor);",
        },
        {
          relPath: 'packages/agent-core/src/context/models.ts',
          content: "'claude-opus-4-5': { contextWindow: 200000 }",
        },
      ],
      CFG,
    );
    expect(findings).toHaveLength(0);
  });
});
