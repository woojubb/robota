import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  applyLabelPlan,
  assertOpenIssueHierarchyPopulation,
  auditCommand,
  auditOpenIssueState,
  auditOpenIssues,
  classifyOpenIssues,
  classifyOpenIssueHierarchy,
  collectOpenTaskCandidates,
  finalizeIssueConversion,
  fetchOpenIssueHierarchy,
  planLabelReconciliation,
  readExaminedLiveLabelCount,
  readExaminedOpenIssueCount,
  readExaminedOpenChildIssueCount,
  resolveOpenTaskLinks,
  scanLiveLabelReconciliation,
  scanOpenIssues,
  scanOpenIssueHierarchy,
  taskMarker,
} from '../github-issue-triage.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

function proceduralBoundaryHolds(text) {
  const normalized = text.replace(/\s+/g, ' ');
  const contradictsBoundary =
    /(?:after decomposition[^.]{0,80}(?:always|must) close the parent|(?:always|must) close the parent[^.]{0,80}after decomposition)/i;
  return (
    normalized.includes('Task decomposition never closes') &&
    normalized.includes('Issue body owns the current') &&
    normalized.includes('Task-marker') &&
    !contradictsBoundary.test(normalized)
  );
}

describe('live GitHub label reconciliation', () => {
  it('plans declared creates and updates while preserving unexpected live labels', () => {
    const declared = [
      { name: 'bug', color: 'd73a4a', description: 'Broken behavior' },
      { name: 'priority:P0', color: 'b60205', description: 'Interrupt candidate' },
    ];
    const live = [
      { name: 'bug', color: 'ffffff', description: 'Old description' },
      { name: 'legacy', color: '000000', description: 'Historical label' },
    ];

    expect(planLabelReconciliation(declared, live)).toEqual({
      create: [declared[1]],
      update: [{ declared: declared[0], live: live[0] }],
      unexpected: [live[1]],
      delete: [],
      examined: 2,
    });
    scanLiveLabelReconciliation(declared, live);
    expect(readExaminedLiveLabelCount()).toBe(2);
    scanLiveLabelReconciliation(declared, live);
    expect(readExaminedLiveLabelCount()).toBe(2);
  });

  it('applies only declared create/update actions and never touches unexpected labels', async () => {
    const calls = [];
    await applyLabelPlan(
      {
        create: [{ name: 'priority:P0', color: 'b60205', description: 'Interrupt' }],
        update: [
          {
            declared: { name: 'bug', color: 'd73a4a', description: 'Broken' },
            live: { name: 'bug', color: 'ffffff', description: 'Old' },
          },
        ],
        unexpected: [{ name: 'legacy', color: '000000', description: 'Preserve' }],
        delete: [],
      },
      { repo: 'owner/repo', runGh: async (args) => calls.push(args) },
    );

    expect(calls).toEqual([
      [
        'label',
        'create',
        'priority:P0',
        '--repo',
        'owner/repo',
        '--color',
        'b60205',
        '--description',
        'Interrupt',
        '--force',
      ],
      [
        'label',
        'create',
        'bug',
        '--repo',
        'owner/repo',
        '--color',
        'd73a4a',
        '--description',
        'Broken',
        '--force',
      ],
    ]);
    expect(JSON.stringify(calls)).not.toContain('legacy');
  });
});

describe('read-only open-Issue audit', () => {
  it('collects every open Task citation instead of keeping the traversal-order winner', () => {
    const root = makeTemp('robota-issue-triage-');
    const directory = path.join(root, '.agents/tasks');
    mkdirSync(directory, { recursive: true });
    for (const name of ['AGREEMENT-004-parent.md', 'FLOW-008-child.md']) {
      writeFileSync(
        path.join(directory, name),
        '---\nissue: https://github.com/woojubb/robota/issues/1987\nstatus: todo\n---\n',
      );
    }

    const candidates = collectOpenTaskCandidates(root);

    expect(candidates.get(1987).map(({ taskPath }) => taskPath)).toEqual([
      '.agents/tasks/AGREEMENT-004-parent.md',
      '.agents/tasks/FLOW-008-child.md',
    ]);
  });

  it('uses the exact AGREEMENT parent marker when several Tasks cite one Issue', () => {
    const parentPath = '.agents/tasks/AGREEMENT-004-parent.md';
    const childPath = '.agents/tasks/FLOW-008-child.md';
    const issue = {
      number: 1987,
      labels: [{ name: 'bug' }],
      comments: [{ body: taskMarker({ id: 'AGREEMENT-004', taskPath: parentPath }) }],
    };
    const candidates = new Map([
      [
        1987,
        [
          {
            taskPath: parentPath,
            taskText:
              '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [FLOW-008]\n---\n',
          },
          {
            taskPath: childPath,
            taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
          },
        ],
      ],
    ]);

    const resolved = resolveOpenTaskLinks([issue], candidates);

    expect(resolved.links.get(1987)).toBe(parentPath);
    expect(resolved.problems).toEqual(new Map());
  });

  it('classifies the marker-owned AGREEMENT parent through the audit path', () => {
    const parentPath = '.agents/tasks/AGREEMENT-004-parent.md';
    const issue = {
      number: 1987,
      labels: [{ name: 'bug' }],
      comments: [{ body: taskMarker({ id: 'AGREEMENT-004', taskPath: parentPath }) }],
    };
    const result = auditOpenIssues(
      [issue],
      new Map([
        [
          1987,
          [
            {
              taskPath: parentPath,
              taskText:
                '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [FLOW-008]\n---\n',
            },
            {
              taskPath: '.agents/tasks/FLOW-008-child.md',
              taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
            },
          ],
        ],
      ]),
    );

    expect(result.converted[0].taskPath).toBe(parentPath);
    expect(result.malformed).toEqual([]);
  });

  it('reports multiple Task citations without a parent marker as malformed', () => {
    const issue = { number: 1987, labels: [{ name: 'bug' }], comments: [] };
    const candidates = new Map([
      [
        1987,
        [
          {
            taskPath: '.agents/tasks/AGREEMENT-004-parent.md',
            taskText:
              '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [FLOW-008]\n---\n',
          },
          {
            taskPath: '.agents/tasks/FLOW-008-child.md',
            taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
          },
        ],
      ],
    ]);
    const resolved = resolveOpenTaskLinks([issue], candidates);

    const result = classifyOpenIssues([issue], resolved.links, resolved.problems);

    expect(result.malformed[0].reason).toMatch(/parent marker/i);
  });

  it('rejects conflicting parent and child markers instead of choosing one', () => {
    const parentPath = '.agents/tasks/AGREEMENT-004-parent.md';
    const childPath = '.agents/tasks/FLOW-008-child.md';
    const issue = {
      number: 1987,
      labels: [{ name: 'bug' }],
      comments: [
        { body: taskMarker({ id: 'AGREEMENT-004', taskPath: parentPath }) },
        { body: taskMarker({ id: 'FLOW-008', taskPath: childPath }) },
      ],
    };
    const candidates = new Map([
      [
        1987,
        [
          {
            taskPath: parentPath,
            taskText:
              '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [FLOW-008]\n---\n',
          },
          {
            taskPath: childPath,
            taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
          },
        ],
      ],
    ]);

    const resolved = resolveOpenTaskLinks([issue], candidates);

    expect(resolved.links.has(1987)).toBe(false);
    expect(resolved.problems.get(1987)).toMatch(/conflicting|one AGREEMENT parent marker/i);
  });

  it('rejects a parent marker whose declared children do not match the Issue candidates', () => {
    const parentPath = '.agents/tasks/AGREEMENT-004-parent.md';
    const issue = {
      number: 1987,
      labels: [{ name: 'bug' }],
      comments: [{ body: taskMarker({ id: 'AGREEMENT-004', taskPath: parentPath }) }],
    };
    const resolved = resolveOpenTaskLinks(
      [issue],
      new Map([
        [
          1987,
          [
            {
              taskPath: parentPath,
              taskText:
                '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [API-999]\n---\n',
            },
            {
              taskPath: '.agents/tasks/FLOW-008-child.md',
              taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
            },
          ],
        ],
      ]),
    );

    expect(resolved.links.has(1987)).toBe(false);
    expect(resolved.problems.get(1987)).toMatch(/children|candidate/i);
  });

  it('classifies every Issue exactly once without guessing missing metadata', () => {
    const issue = (number, labels) => ({
      number,
      title: `Issue ${number}`,
      labels: labels.map((name) => ({ name })),
    });
    const result = classifyOpenIssues(
      [
        issue(1, ['bug', 'status:needs-triage']),
        issue(2, ['enhancement', 'priority:P1']),
        issue(3, ['documentation']),
        issue(4, []),
      ],
      new Map([[3, '.agents/tasks/RULE-003-example.md']]),
    );

    expect(result.intake.map(({ issue: item }) => item.number)).toEqual([1]);
    expect(result.candidates.map(({ issue: item }) => item.number)).toEqual([2]);
    expect(result.converted.map(({ issue: item }) => item.number)).toEqual([3]);
    expect(result.malformed.map(({ issue: item }) => item.number)).toEqual([4]);
    expect([
      ...result.intake,
      ...result.candidates,
      ...result.converted,
      ...result.malformed,
    ]).toHaveLength(4);
    scanOpenIssues(
      [
        issue(1, ['bug', 'status:needs-triage']),
        issue(2, ['enhancement', 'priority:P1']),
        issue(3, ['documentation']),
        issue(4, []),
      ],
      new Map([[3, '.agents/tasks/RULE-003-example.md']]),
    );
    expect(readExaminedOpenIssueCount()).toBe(4);
    scanOpenIssues([issue(6, []), issue(7, [])], new Map());
    expect(readExaminedOpenIssueCount()).toBe(2);
  });
});

describe('read-only native child-Issue audit', () => {
  it('ignores roots and requires a non-empty independent-lifecycle section on every child', () => {
    const nodes = [
      { number: 1, title: 'Root', body: 'Root body', parent: null },
      {
        number: 2,
        title: 'Retained child',
        body: 'Context\n\n## Independent external lifecycle\nSeparate security disclosure audience.\n\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
        parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
      },
      {
        number: 3,
        title: 'Internal child',
        body: '## Independent external lifecycle\n\n## Notes\nOnly implementation detail.',
        parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
      },
    ];

    expect(classifyOpenIssueHierarchy(nodes)).toEqual({
      retained: [
        {
          issue: nodes[1],
          parentNumber: 1,
          parentUrl: 'https://github.com/owner/repo/issues/1',
          reason: 'Separate security disclosure audience.',
          semanticReview: 'Semantic review: @reviewer on 2026-08-30 — RETAIN',
        },
      ],
      missing: [
        {
          issue: nodes[2],
          parentNumber: 1,
          parentUrl: 'https://github.com/owner/repo/issues/1',
          reason: 'missing or blank section',
        },
      ],
      examined: 2,
    });
    scanOpenIssueHierarchy(nodes);
    expect(readExaminedOpenChildIssueCount()).toBe(2);
    scanOpenIssueHierarchy([nodes[1]]);
    expect(readExaminedOpenChildIssueCount()).toBe(1);
  });

  it('treats an HTML-comment-only lifecycle section as blank', () => {
    const child = {
      number: 2,
      title: 'Placeholder child',
      body: '## Independent external lifecycle\n<!-- TODO: explain later -->',
      parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
    };

    expect(classifyOpenIssueHierarchy([child]).missing).toEqual([
      {
        issue: child,
        parentNumber: 1,
        parentUrl: 'https://github.com/owner/repo/issues/1',
        reason: 'missing or blank section',
      },
    ]);
  });

  it('does not borrow visible text from a following H1 section', () => {
    const child = {
      number: 3,
      title: 'Empty lifecycle before another section',
      body: '## Independent external lifecycle\n\n# Notes\nInternal implementation only.',
      parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
    };

    expect(classifyOpenIssueHierarchy([child]).missing).toHaveLength(1);
  });

  it('does not retain a reason-only child without the semantic review receipt', () => {
    const child = {
      number: 5,
      title: 'Unreviewed lifecycle',
      body: '## Independent external lifecycle\nSeparate external release.',
      parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
    };

    expect(classifyOpenIssueHierarchy([child]).missing).toEqual([
      {
        issue: child,
        parentNumber: 1,
        parentUrl: 'https://github.com/owner/repo/issues/1',
        reason: 'missing semantic RETAIN review receipt',
      },
    ]);
  });

  it('accepts a valid 39-character reviewer login', () => {
    const reviewer = 'a'.repeat(39);
    const child = {
      number: 7,
      title: 'Maximum-length reviewer',
      body: `## Independent external lifecycle\nSeparate release.\nSemantic review: @${reviewer} on 2026-08-30 — RETAIN`,
      parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
    };

    expect(classifyOpenIssueHierarchy([child]).retained).toHaveLength(1);
  });

  it.each([
    {
      name: 'a reviewer login ending in a hyphen',
      body: 'Separate release.\nSemantic review: @reviewer- on 2026-08-30 — RETAIN',
    },
    {
      name: 'a reviewer login containing consecutive hyphens',
      body: 'Separate release.\nSemantic review: @review--name on 2026-08-30 — RETAIN',
    },
    {
      name: 'an impossible calendar date',
      body: 'Separate release.\nSemantic review: @reviewer on 2026-99-99 — RETAIN',
    },
    {
      name: 'a non-leap-year February 29 date',
      body: 'Separate release.\nSemantic review: @reviewer on 2025-02-29 — RETAIN',
    },
    {
      name: 'a 40-character reviewer login',
      body: `Separate release.\nSemantic review: @${'a'.repeat(40)} on 2026-08-30 — RETAIN`,
    },
    {
      name: 'a fenced-code-only lifecycle section',
      body: '```markdown\n## Independent external lifecycle\nFake reason.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\n```',
      completeBody: true,
    },
    {
      name: 'a four-space-indented-code-only lifecycle section',
      body: '    ## Independent external lifecycle\n    Fake reason.\n    Semantic review: @reviewer on 2026-08-30 — RETAIN',
      completeBody: true,
    },
    {
      name: 'a tab-indented-code-only lifecycle section',
      body: '\t## Independent external lifecycle\n\tFake reason.\n\tSemantic review: @reviewer on 2026-08-30 — RETAIN',
      completeBody: true,
    },
    {
      name: 'a space-plus-tab-indented-code-only lifecycle section',
      body: '   \t## Independent external lifecycle\n   \tFake reason.\n   \tSemantic review: @reviewer on 2026-08-30 — RETAIN',
      completeBody: true,
    },
    {
      name: 'an HTML preformatted-code-only lifecycle reason',
      body: '<pre>Fake reason.</pre>\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'a thematic-break-only lifecycle reason',
      body: '---\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'an empty-link-only lifecycle reason',
      body: '[](https://example.test)\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'an HTML-wrapper-and-rule-only lifecycle reason',
      body: '<div><pre>Fake reason.</pre></div>\n<hr>\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'a Unicode-zero-width-only lifecycle reason',
      body: '\u200B\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'a Unicode-default-ignorable-only lifecycle reason',
      body: '\u034F\u180B\uFE0F\u{E0100}\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'numeric-and-named-invisible-entity-only lifecycle reasons',
      body: '&#8203;&#x20;&Tab;&NewLine;&ZeroWidthSpace;\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'an empty HTML element with a greater-than sign inside an attribute',
      body: '<span title=">hidden"></span>\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'a second lifecycle section hiding another receipt',
      body: '## Independent external lifecycle\nSeparate release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\n\n## Independent external lifecycle\nSeparate audience.\nSemantic review: @other on 2026-08-30 — RETAIN',
      completeBody: true,
    },
    {
      name: 'duplicate receipts with no observable reason',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSemantic review: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a malformed receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSemantic review: reviewer on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a colonless receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSemantic review @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a list-item receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\n- Semantic review: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus an NBSP receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSemantic\u00A0review: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a Markdown-emphasis receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSemantic **review**: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus an HTML-entity receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSemantic&nbsp;review: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus an HTML-break receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSemantic<br>review: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a Markdown-hard-break receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSemantic  \nreview: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a raw zero-width token receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSem\u200Cantic review: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a numeric zero-width token receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSem&#8204;antic review: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a named zero-width token receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSem&zwnj;antic review: @other on 2026-08-30 — RETAIN',
    },
    {
      name: 'one valid receipt plus a soft-hyphen token receipt variant',
      body: 'Separate external release.\nSemantic review: @reviewer on 2026-08-30 — RETAIN\nSem&shy;antic review: @other on 2026-08-30 — RETAIN',
    },
  ])('rejects $name', ({ body, completeBody = false }) => {
    const child = {
      number: 6,
      title: 'Malformed semantic receipt',
      body: completeBody ? body : `## Independent external lifecycle\n${body}`,
      parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
    };

    expect(classifyOpenIssueHierarchy([child]).retained).toHaveLength(0);
    expect(classifyOpenIssueHierarchy([child]).missing).toHaveLength(1);
  });

  it.each([
    {
      name: 'an unclosed HTML comment',
      body: '## Independent external lifecycle\n<!-- TODO',
    },
    {
      name: 'a lifecycle heading inside an HTML comment',
      body: '<!--\n## Independent external lifecycle\nFake visible reason.\n-->',
    },
    {
      name: 'a following Setext section',
      body: '## Independent external lifecycle\n\nNotes\n-----\nInternal implementation only.',
    },
  ])('rejects $name as readable lifecycle evidence', ({ body }) => {
    const child = {
      number: 4,
      title: 'Unreadable lifecycle',
      body,
      parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
    };

    expect(classifyOpenIssueHierarchy([child]).missing).toHaveLength(1);
  });

  it('fetches every GraphQL page exactly once', async () => {
    const cursors = [];
    const pages = [
      {
        nodes: [{ number: 1, title: 'Root', body: '', parent: null }],
        pageInfo: { hasNextPage: true, endCursor: 'next' },
      },
      {
        nodes: [
          {
            number: 2,
            title: 'Child',
            body: '',
            parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    ];

    const nodes = await fetchOpenIssueHierarchy({
      owner: 'owner',
      name: 'repo',
      runPage: async ({ after }) => {
        cursors.push(after);
        return pages[cursors.length - 1];
      },
    });

    expect(cursors).toEqual([null, 'next']);
    expect(nodes.map(({ number }) => number)).toEqual([1, 2]);
  });

  it('fails closed when a GraphQL node omits the requested parent field', async () => {
    await expect(
      fetchOpenIssueHierarchy({
        owner: 'owner',
        name: 'repo',
        runPage: async () => ({
          nodes: [{ number: 1, title: 'Incomplete root', body: '' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
      }),
    ).rejects.toThrow(/parent field/i);
  });

  it('preserves a cross-repository parent URL in audit output', async () => {
    const output = [];
    await auditCommand({
      args: [],
      repo: 'owner/repo',
      root: WORKSPACE_ROOT,
      listIssues: async () => [
        { number: 2, title: 'Cross-repo child', labels: [{ name: 'enhancement' }] },
      ],
      taskCandidates: new Map(),
      runHierarchyPage: async () => ({
        nodes: [
          {
            number: 2,
            title: 'Cross-repo child',
            body: '## Independent external lifecycle\nSeparate consumer lifecycle.\n\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
            parent: { number: 7, url: 'https://github.com/other/project/issues/7' },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
      write: (line) => output.push(line),
      markFailure: () => {},
    });

    expect(
      output.some((line) => line.includes('parent=https://github.com/other/project/issues/7')),
    ).toBe(true);
  });

  it('fails closed when GraphQL repeats a pagination cursor', async () => {
    await expect(
      fetchOpenIssueHierarchy({
        owner: 'owner',
        name: 'repo',
        runPage: async () => ({
          nodes: [],
          pageInfo: { hasNextPage: true, endCursor: 'same' },
        }),
      }),
    ).rejects.toThrow(/repeated.*cursor/i);
  });

  it('propagates a GraphQL page error without returning a partial hierarchy', async () => {
    let calls = 0;
    await expect(
      fetchOpenIssueHierarchy({
        owner: 'owner',
        name: 'repo',
        runPage: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              nodes: [{ number: 1, parent: null }],
              pageInfo: { hasNextPage: true, endCursor: 'next' },
            };
          }
          throw new Error('GraphQL visibility denied');
        },
      }),
    ).rejects.toThrow('GraphQL visibility denied');
    expect(calls).toBe(2);
  });

  it('fails closed when REST and GraphQL open-Issue populations differ', () => {
    expect(() =>
      assertOpenIssueHierarchyPopulation(
        [{ number: 1 }, { number: 2 }],
        [{ number: 1 }, { number: 3 }],
      ),
    ).toThrow(/REST-only=#2.*GraphQL-only=#3/);
  });

  it('combines the ordinary intake audit with the native hierarchy audit', () => {
    const issues = [
      { number: 1, title: 'Root', labels: [{ name: 'bug' }, { name: 'status:needs-triage' }] },
      { number: 2, title: 'Child', labels: [{ name: 'enhancement' }] },
    ];
    const result = auditOpenIssueState({
      issues,
      taskCandidates: new Map([
        [2, [{ taskPath: '.agents/tasks/RULE-999-child.md', taskText: '' }]],
      ]),
      hierarchyNodes: [
        { ...issues[0], body: '', parent: null },
        {
          ...issues[1],
          body: '',
          parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
        },
      ],
    });

    expect(result.issues.intake.map(({ issue }) => issue.number)).toEqual([1]);
    expect(result.issues.converted.map(({ issue }) => issue.number)).toEqual([2]);
    expect(result.hierarchy.missing.map(({ issue }) => issue.number)).toEqual([2]);
  });

  it('runs hierarchy enforcement through the ordinary audit --check command', async () => {
    const issues = [
      { number: 1, title: 'Root', labels: [{ name: 'bug' }, { name: 'status:needs-triage' }] },
      { number: 2, title: 'Child', labels: [{ name: 'enhancement' }] },
    ];
    const output = [];
    let failed = false;

    await auditCommand({
      args: ['--check'],
      repo: 'owner/repo',
      root: WORKSPACE_ROOT,
      listIssues: async () => issues,
      taskCandidates: new Map([
        [2, [{ taskPath: '.agents/tasks/RULE-999-child.md', taskText: '' }]],
      ]),
      runHierarchyPage: async () => ({
        nodes: [
          { ...issues[0], body: '', parent: null },
          {
            ...issues[1],
            body: '',
            parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
      write: (line) => output.push(line),
      markFailure: () => {
        failed = true;
      },
    });

    expect(output).toContain('native-child-missing: 1');
    expect(output).toContain('::examined:: 1 open child issue(s)');
    expect(failed).toBe(true);
  });

  it('does not fail --check for a valid retained child and well-formed intake', async () => {
    let failed = false;
    await auditCommand({
      args: ['--check'],
      repo: 'owner/repo',
      root: WORKSPACE_ROOT,
      listIssues: async () => [
        {
          number: 2,
          title: 'Retained child',
          labels: [{ name: 'enhancement' }, { name: 'priority:P1' }],
        },
      ],
      taskCandidates: new Map(),
      runHierarchyPage: async () => ({
        nodes: [
          {
            number: 2,
            title: 'Retained child',
            body: '## Independent external lifecycle\nSeparate external release.\n\nSemantic review: @reviewer on 2026-08-30 — RETAIN',
            parent: { number: 1, url: 'https://github.com/owner/repo/issues/1' },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
      write: () => {},
      markFailure: () => {
        failed = true;
      },
    });

    expect(failed).toBe(false);
  });

  it('reports zero hierarchy failures while unrelated malformed intake still fails aggregate check', async () => {
    const output = [];
    let failed = false;
    const malformed = { number: 1, title: 'Malformed root', labels: [] };
    await auditCommand({
      args: ['--check'],
      repo: 'owner/repo',
      root: WORKSPACE_ROOT,
      listIssues: async () => [malformed],
      taskCandidates: new Map(),
      runHierarchyPage: async () => ({
        nodes: [{ ...malformed, body: '', parent: null }],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
      write: (line) => output.push(line),
      markFailure: () => {
        failed = true;
      },
    });

    expect(output).toContain('native-child-missing: 0');
    expect(output).toContain('::examined:: 0 open child issue(s)');
    expect(failed).toBe(true);
  });

  it('accepts a root-only hierarchy with no hierarchy failure', async () => {
    const root = {
      number: 1,
      title: 'Root intake',
      labels: [{ name: 'bug' }, { name: 'status:needs-triage' }],
    };
    let failed = false;
    await auditCommand({
      args: ['--check'],
      repo: 'owner/repo',
      root: WORKSPACE_ROOT,
      listIssues: async () => [root],
      taskCandidates: new Map(),
      runHierarchyPage: async () => ({
        nodes: [{ ...root, body: '', parent: null }],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
      write: () => {},
      markFailure: () => {
        failed = true;
      },
    });

    expect(failed).toBe(false);
  });
});

describe('Issue to Task conversion finalization', () => {
  it('reads back an idempotent Task marker before removing priority labels', async () => {
    const taskPath = '.agents/tasks/RULE-018-example.md';
    const taskText = `---\nissue: https://github.com/woojubb/robota/issues/18\nurgency: soon\n---\n`;
    const marker = taskMarker({ id: 'RULE-018', taskPath });
    const events = [];
    let posted = false;
    let removed = false;
    const getIssue = async () => {
      events.push('get');
      return {
        labels: removed ? [{ name: 'bug' }] : [{ name: 'bug' }, { name: 'priority:P1' }],
        comments: posted ? [{ body: marker }] : [],
      };
    };

    await finalizeIssueConversion({
      repo: 'woojubb/robota',
      issueNumber: 18,
      taskPath,
      taskText,
      getIssue,
      postComment: async (body) => {
        events.push('post');
        expect(body).toBe(marker);
        posted = true;
      },
      removeLabels: async (labels) => {
        events.push('remove');
        expect(labels).toEqual(['priority:P1']);
        removed = true;
      },
    });

    expect(events).toEqual(['get', 'post', 'get', 'remove', 'get']);
  });

  it('does not remove priority when Task-marker write-back fails', async () => {
    let removeCalled = false;
    await expect(
      finalizeIssueConversion({
        repo: 'woojubb/robota',
        issueNumber: 18,
        taskPath: '.agents/tasks/RULE-018-example.md',
        taskText: '---\nissue: https://github.com/woojubb/robota/issues/18\nurgency: now\n---\n',
        getIssue: async () => ({
          labels: [{ name: 'bug' }, { name: 'priority:P0' }],
          comments: [],
        }),
        postComment: async () => {
          throw new Error('write failed');
        },
        removeLabels: async () => {
          removeCalled = true;
        },
      }),
    ).rejects.toThrow('write failed');
    expect(removeCalled).toBe(false);
  });

  it('rejects a Task that cites the same Issue number in a different repository', async () => {
    await expect(
      finalizeIssueConversion({
        repo: 'woojubb/robota',
        issueNumber: 18,
        taskPath: '.agents/tasks/RULE-018-example.md',
        taskText:
          '---\nissue: https://github.com/different/repository/issues/18\nurgency: now\n---\n',
        getIssue: async () => ({
          labels: [{ name: 'bug' }, { name: 'priority:P0' }],
          comments: [],
        }),
        postComment: async () => {},
        removeLabels: async () => {},
      }),
    ).rejects.toThrow('Task source issue does not match');
  });
});

describe('the rule owns policy and the skill owns procedure', () => {
  it('pins the authority handoff and the commands that execute it', () => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const skill = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/skills/github-issue-triage/SKILL.md'),
      'utf8',
    );

    expect(rule).toContain('GitHub Issue Intake and Conversion Queue');
    expect(rule).toContain('Task `priority` and `urgency` are the sole execution authority');
    expect(rule).toContain('P2 must be promoted to P1 before conversion');
    expect(skill).toContain('github-issue-triage.mjs audit');
    expect(skill).toContain('github-issue-triage.mjs convert');
    expect(skill).toContain('github-issue-triage.mjs labels');
  });

  it('keeps internal decomposition in Tasks and makes child Issues exception-only', () => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const conversion = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/skills/issue-to-backlog/SKILL.md'),
      'utf8',
    );
    const triage = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/skills/github-issue-triage/SKILL.md'),
      'utf8',
    );
    const tasks = readFileSync(path.join(WORKSPACE_ROOT, '.agents/tasks/README.md'), 'utf8');
    const normalizedRule = rule.replace(/\s+/g, ' ');
    const normalizedConversion = conversion.replace(/\s+/g, ' ');
    const normalizedTriage = triage.replace(/\s+/g, ' ');
    const normalizedTasks = tasks.replace(/\s+/g, ' ');

    expect(normalizedRule).toContain('Child Issues are exception-only');
    expect(normalizedRule).toContain('## Independent external lifecycle');
    expect(normalizedRule).toContain('reviewer other than the author or migration actor');
    expect(normalizedRule).toContain('independently forces `OWNER_REVIEW`');
    expect(normalizedRule).toContain('approved frozen migration manifest');
    expect(normalizedRule).toContain(
      "without that new Task's mere existence forcing `OWNER_REVIEW`",
    );
    expect(normalizedRule).toContain('The Issue body owns the current external problem');
    expect(normalizedRule).toContain('Narrative comments are optional');
    expect(normalizedConversion).toContain('Create Tasks for internal cause decomposition');
    expect(normalizedConversion).not.toContain('close the parent with a decomposition comment');
    expect(normalizedConversion).toContain('semantic `RETAIN` review');
    expect(normalizedConversion).toContain('Any one forces `OWNER_REVIEW`');
    expect(normalizedConversion).toContain(
      'new canonical migration Task created from an approved frozen manifest',
    );
    expect(normalizedTriage).toContain('audits native child relationships');
    expect(normalizedTriage).toContain('## Independent external lifecycle');
    expect(normalizedTriage).toContain('Do not mutate an `OWNER_REVIEW` row');
    expect(normalizedTriage).toContain(
      'new canonical migration Task from an approved frozen manifest',
    );
    expect(normalizedTasks).toContain('Child Issues are exception-only');
    expect(normalizedTasks).toContain('Semantic review: @<github-login> on YYYY-MM-DD — RETAIN');
    expect(normalizedTasks).toContain('The Issue body owns the current external problem');
    expect(normalizedTasks).toContain('Narrative comments are optional');
    expect(proceduralBoundaryHolds(conversion)).toBe(true);
    expect(proceduralBoundaryHolds(triage)).toBe(true);
    expect(
      proceduralBoundaryHolds(`${conversion}\nAfter decomposition, always close the parent.`),
    ).toBe(false);
  });

  it('archives RULE-021 as superseded without claiming Issue #2490', () => {
    expect(collectOpenTaskCandidates(WORKSPACE_ROOT).has(2490)).toBe(false);

    const archivedTask = readFileSync(
      path.join(
        WORKSPACE_ROOT,
        '.agents/tasks/completed/RULE-021-close-parent-on-decomposition.md',
      ),
      'utf8',
    );
    const rejectedSpec = readFileSync(
      path.join(
        WORKSPACE_ROOT,
        '.agents/spec-docs/rejected/RULE-021-close-parent-on-decomposition.md',
      ),
      'utf8',
    );

    expect(archivedTask).toContain('status: superseded');
    expect(archivedTask).not.toMatch(/^issue:/m);
    expect(archivedTask).toContain('PR #2493');
    expect(rejectedSpec).toContain('status: rejected');
    expect(rejectedSpec).toContain('RULE-023');
    expect(rejectedSpec).toContain('cbe0ec14992fd7390da9e7bd5279e112883b42c3');
    expect(rejectedSpec).toContain(
      '- [x] `.agents/tasks/completed/RULE-021-close-parent-on-decomposition.md` — superseded', // allow-missing-artifact: assertion verifies the archived document's current Task row
    );
    expect(rejectedSpec).toContain(
      'GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-021-close-parent-on-decomposition.md`, which exists', // allow-missing-artifact: assertion verifies a frozen historical path, not a live citation
    );
    expect(rejectedSpec).toContain(
      "GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-021-close-parent-on-decomposition.md`, whose basename is the spec's", // allow-missing-artifact: assertion verifies a frozen historical path, not a live citation
    );
  });
});
