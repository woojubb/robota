import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SCAN_COMMANDS } from '../run-all-scans.mjs';
import {
  findPublicProjectAuthorityFindings,
  readExaminedPublicProjectAuthorityCount,
} from '../scan-public-project-authority.mjs';

function scan(source, barrel = source) {
  const files = ['api.ts', 'barrel.ts'];
  const content = new Map([
    ['api.ts', source],
    ['barrel.ts', barrel],
  ]);
  return findPublicProjectAuthorityFindings(files, ['barrel.ts'], (file) => content.get(file));
}

describe('public-project-authority AST guard', () => {
  it('RED: rejects a public project loader that accepts only cwd', () => {
    const findings = scan(
      'export function loadProjectContext(cwd: string): void {}',
      "export { loadProjectContext } from './api.js';",
    );
    expect(findings.map((finding) => finding.rule)).toContain('bare-project-path');
  });

  it('RED: rejects optional project authority or reader members', () => {
    const findings = scan(
      'export interface IProjectLoader { reader?: IWorkspaceProjectReader }',
      "export type { IProjectLoader } from './api.js';",
    );
    expect(findings.map((finding) => finding.rule)).toContain('optional-project-authority');
  });

  it('RED: rejects a high-level construction options interface with cwd but no project decision', () => {
    const findings = scan(
      'export interface IInteractiveRuntimeOptions { cwd?: string; provider: IAIProvider }',
      "export type { IInteractiveRuntimeOptions } from './api.js';",
    );
    expect(findings.map((finding) => finding.rule)).toContain(
      'high-level-project-decision-missing',
    );
  });

  it('RED: rejects a generic filesystem presented as project trust', () => {
    const findings = scan(
      'export function loadProjectContext(fs: IFileSystem): void {}',
      "export { loadProjectContext } from './api.js';",
    );
    expect(findings.map((finding) => finding.rule)).toContain('generic-filesystem-as-trust');
  });

  it('RED: rejects ambient Node I/O in a public project loader', () => {
    const findings = scan(
      "export function loadProjectContext(): string { return readFileSync('.robota/x', 'utf8'); }",
      "export { loadProjectContext } from './api.js';",
    );
    expect(findings.map((finding) => finding.rule)).toContain('ambient-node-fallback');
  });

  it('RED: rejects a production/testing barrel that exports the private issuer', () => {
    const findings = scan(
      'function harmless(): void {}',
      "export { mintWorkspaceProjectAuthority } from './private.js';",
    );
    expect(findings.map((finding) => finding.rule)).toContain(
      'production-authority-issuer-exported',
    );
  });

  it('RED: rejects calls to removed ambient project path helpers in consumers', () => {
    const findings = scan('export function consumer(): void { projectPaths(process.cwd()); }');
    expect(findings.map((finding) => finding.rule)).toContain('removed-ambient-helper-call');
  });

  it('GREEN: accepts authority-derived ports, Restricted construction, and explicit host adapters', () => {
    const source = [
      'export interface ICreateProjectOptions { projectAccess?: TWorkspaceProjectAccess }',
      'export function loadProjectContext(reader: IWorkspaceProjectReader): void {}',
      'export function createNodeHostProjectReader(root: string): void {',
      "  readFileSync(root, 'utf8');",
      '}',
    ].join('\n');
    const barrel = [
      "export type { ICreateProjectOptions } from './api.js';",
      "export { loadProjectContext, createNodeHostProjectReader } from './api.js';",
    ].join('\n');
    expect(scan(source, barrel)).toEqual([]);
  });

  it('reports the exact examined population instead of a self-asserted non-zero pass', () => {
    findPublicProjectAuthorityFindings(
      ['single.ts'],
      ['single.ts'],
      () => 'export function harmless(): void {}',
    );
    expect(readExaminedPublicProjectAuthorityCount()).toBe(1);

    findPublicProjectAuthorityFindings(
      ['single.ts'],
      ['single.ts'],
      () => 'export function harmlessAgain(): void {}',
    );
    expect(readExaminedPublicProjectAuthorityCount()).toBe(1);
  });

  it('is registered and passes against the live governed tree', () => {
    const command = SCAN_COMMANDS.find((entry) => entry.name === 'public-project-authority');
    expect(command?.command).toEqual(['node', 'scripts/harness/scan-public-project-authority.mjs']);

    const root = path.resolve(import.meta.dirname, '../../..');
    const output = execFileSync('node', ['scripts/harness/scan-public-project-authority.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toContain('public-project-authority scan passed.');
    expect(output).toMatch(/::examined:: [1-9]\d* TypeScript file\(s\)/);
  });
});
