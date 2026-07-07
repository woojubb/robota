import { describe, expect, it } from 'vitest';

import { findRuntimeViolationsInSource } from '../scan-interface-runtime.mjs';

/** Convenience: does this source produce at least one violation? */
function fails(src) {
  return findRuntimeViolationsInSource(src, 'fixture.ts').length > 0;
}

describe('scan-interface-runtime (INFRA-035) — FAIL cases', () => {
  it('flags a bare third-party value import (`import { z } from "zod"`)', () => {
    const v = findRuntimeViolationsInSource("import { z } from 'zod';");
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('runtime-import');
  });

  it('flags a value @robota-sdk/* import', () => {
    expect(fails("import { createThing } from '@robota-sdk/agent-core';")).toBe(true);
  });

  it('flags a default value import (`import Foo from "x"`)', () => {
    const v = findRuntimeViolationsInSource("import Foo from 'x';");
    expect(v).toHaveLength(1);
    expect(v[0].detail).toMatch(/default value import/);
  });

  it('flags a namespace value import (`import * as z from "x"`)', () => {
    const v = findRuntimeViolationsInSource("import * as z from 'x';");
    expect(v).toHaveLength(1);
    expect(v[0].detail).toMatch(/namespace value import/);
  });

  it('flags a `class` declaration', () => {
    const v = findRuntimeViolationsInSource('export class Foo {}');
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('runtime-construct');
  });

  it('flags an `enum` declaration', () => {
    expect(fails('export enum E { A, B }')).toBe(true);
  });

  it('flags an `abstract class` and a `const enum`', () => {
    expect(fails('abstract class Base {}')).toBe(true);
    expect(fails('const enum CE { X }')).toBe(true);
  });

  it('flags a bare value re-export (`export { x } from "pkg"`)', () => {
    expect(fails("export { readThing } from '@robota-sdk/agent-core';")).toBe(true);
  });

  it('flags `export *` and side-effect / import-require from a bare specifier', () => {
    expect(fails("export * from 'zod';")).toBe(true);
    expect(fails("import 'side-effect';")).toBe(true);
    expect(fails("import z = require('zod');")).toBe(true);
  });

  it('reports the correct 1-based line number', () => {
    const src = ['// a comment', '', "import { z } from 'zod';"].join('\n');
    const v = findRuntimeViolationsInSource(src);
    expect(v[0].line).toBe(3);
  });
});

describe('scan-interface-runtime (INFRA-035) — PASS cases', () => {
  it('allows a multi-line `import type { … } from "@robota-sdk/agent-core"`', () => {
    const src = [
      'import type {',
      '  IActionRequest,',
      '  TActionResponse,',
      "} from '@robota-sdk/agent-core';",
    ].join('\n');
    expect(findRuntimeViolationsInSource(src)).toHaveLength(0);
  });

  it('allows inline type-qualified named specifiers', () => {
    expect(fails("import { type IThing, type TOther } from '@robota-sdk/agent-core';")).toBe(false);
    expect(fails("export type { IThing } from '@robota-sdk/agent-core';")).toBe(false);
  });

  it('does not treat the word `class` inside a comment as a declaration', () => {
    const src = [
      '// the BackgroundTaskError class stays in agent-executor',
      '/* class Foo — described in prose only */',
      'export type T = string;',
    ].join('\n');
    expect(findRuntimeViolationsInSource(src)).toHaveLength(0);
  });

  it('allows a relative value re-export', () => {
    expect(fails("export { readAssistantReplies } from './interaction-contracts.js';")).toBe(false);
  });

  it('allows relative value imports and pure exported accessor functions', () => {
    const src = [
      "import { helper } from './helper.js';",
      'export function readAssistantReplies(events) {',
      '  return events.filter((e) => e.type === "assistant-done").map((e) => e.fullText);',
      '}',
      'export function readLastAssistantText(events) { return readAssistantReplies(events).at(-1); }',
      'export function readToolCalls(events) { return events.filter((e) => e.type === "tool-call"); }',
      'export function readErrors(events) { return events.filter((e) => e.type === "error"); }',
    ].join('\n');
    expect(findRuntimeViolationsInSource(src)).toHaveLength(0);
  });

  it('allows a local `export { x }` without a `from` clause', () => {
    const src = ['type T = string;', 'export { T };'].join('\n');
    expect(findRuntimeViolationsInSource(src)).toHaveLength(0);
  });
});
