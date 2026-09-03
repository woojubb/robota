/**
 * TOOL-004 — a builtin tool's model-facing DESCRIPTION must agree with its SCHEMA and RUNTIME.
 *
 * NEUT-002 (`builtin-descriptions.test.ts`) checks the override seam and product-neutral wording;
 * nothing there compared the parameter NAMES a description uses with the names the schema accepts,
 * so `Read` said `file_path` while accepting `filePath`, and `Shell` asked for a `description`
 * parameter it has no property for and promised a 30,000-character truncation it does not perform.
 *
 * Two contracts, both mechanical:
 * - every snake_case token in a description (top-level or per-property) is a schema property name
 *   or an enum value the schema accepts;
 * - every "the X parameter" phrase names a schema property.
 * Plus the Shell runtime claims that were unenforced, pinned by name so they cannot return.
 */

import { tmpdir } from 'node:os';

import { describe, it, expect } from 'vitest';

import { createAskUserQuestionTool } from '../builtins/ask-user-question-tool.js';
import { createEditTool } from '../builtins/edit-tool.js';
import { createGlobTool } from '../builtins/glob-tool.js';
import { createGrepTool } from '../builtins/grep-tool.js';
import { createReadTool } from '../builtins/read-tool.js';
import { createShellTool } from '../builtins/shell-tool.js';
import { createWebFetchTool } from '../builtins/web-fetch-tool.js';
import { createWebSearchTool } from '../builtins/web-search-tool.js';
import { createWriteTool } from '../builtins/write-tool.js';

import type { FunctionTool } from '@robota-sdk/agent-core';

/** Inert containment root — every case reads text only and never touches the filesystem. */
const ROOT = tmpdir();

const BUILTINS: ReadonlyArray<{ name: string; tool: FunctionTool }> = [
  { name: 'Read', tool: createReadTool({ cwd: ROOT }) },
  { name: 'Edit', tool: createEditTool({ cwd: ROOT }) },
  { name: 'Write', tool: createWriteTool({ cwd: ROOT }) },
  { name: 'Glob', tool: createGlobTool({ cwd: ROOT }) },
  { name: 'Grep', tool: createGrepTool({ cwd: ROOT }) },
  { name: 'Shell', tool: createShellTool({ cwd: ROOT }) },
  { name: 'WebFetch', tool: createWebFetchTool({}) },
  { name: 'WebSearch', tool: createWebSearchTool({}) },
  { name: 'AskUserQuestion', tool: createAskUserQuestionTool({}) },
];

/** `foo_bar` / `foo_bar_baz` — the shape a stale parameter name takes in prose. */
const SNAKE_CASE_TOKEN = /\b[a-z]+(?:_[a-z]+)+\b/g;
/** "The filePath parameter" — an explicit parameter reference that must resolve to a property. */
const NAMED_PARAMETER = /\bthe ([A-Za-z_][A-Za-z0-9_]*) parameter\b/gi;

interface ISchemaProperty {
  description?: string;
  enum?: readonly unknown[];
}

function schemaProperties(tool: FunctionTool): Record<string, ISchemaProperty> {
  return (tool.schema.parameters.properties ?? {}) as Record<string, ISchemaProperty>;
}

/**
 * The names a description may legitimately spell in snake_case: schema property names, and the
 * string values of any enum property (`files_with_matches` is a VALUE of Grep's `outputMode`, and a
 * description that names the accepted values is doing its job, not drifting).
 */
function schemaVocabulary(tool: FunctionTool): Set<string> {
  const properties = schemaProperties(tool);
  const vocabulary = new Set(Object.keys(properties));
  for (const property of Object.values(properties)) {
    for (const value of property.enum ?? []) {
      if (typeof value === 'string') vocabulary.add(value);
    }
  }
  return vocabulary;
}

/** Every model-facing text of a tool: the top-level description plus each property description. */
function modelFacingTexts(tool: FunctionTool): string[] {
  const properties = schemaProperties(tool);
  return [
    tool.getDescription(),
    ...Object.values(properties).map((property) => property.description ?? ''),
  ];
}

describe('builtin descriptions name only parameters their schema accepts (TOOL-004)', () => {
  for (const { name, tool } of BUILTINS) {
    const propertyNames = new Set(Object.keys(schemaProperties(tool)));
    const vocabulary = schemaVocabulary(tool);

    it(`${name}: every snake_case token in its descriptions is a schema property or enum value`, () => {
      const offenders = modelFacingTexts(tool)
        .flatMap((text) => text.match(SNAKE_CASE_TOKEN) ?? [])
        .filter((token) => !vocabulary.has(token));
      expect(offenders).toEqual([]);
    });

    it(`${name}: every "the X parameter" phrase names a schema property`, () => {
      const offenders = modelFacingTexts(tool)
        .flatMap((text) => Array.from(text.matchAll(NAMED_PARAMETER), (match) => match[1] ?? ''))
        .filter((token) => !propertyNames.has(token));
      expect(offenders).toEqual([]);
    });
  }
});

describe('Shell describes only mechanisms it enforces (TOOL-004)', () => {
  const description = createShellTool({ cwd: ROOT }).getDescription();
  const propertyNames = Object.keys(schemaProperties(createShellTool({ cwd: ROOT })));

  it('has no `description` parameter, so it does not ask the model to write one', () => {
    expect(propertyNames).not.toContain('description');
    expect(description).not.toMatch(/keep the description brief/i);
  });

  it('does not claim a working directory that persists between calls', () => {
    expect(description).not.toMatch(/persists between/i);
  });

  it('does not claim an output truncation it does not perform', () => {
    expect(description).not.toMatch(/30,?000|truncat/i);
  });

  it('names the schema parameter that actually selects the working directory', () => {
    expect(propertyNames).toContain('workingDirectory');
    expect(description).toContain('workingDirectory');
  });
});
