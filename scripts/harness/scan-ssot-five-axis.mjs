#!/usr/bin/env node

/** HARNESS-2253 — derived five-axis SSOT consistency checks. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
export const scanDefinition = {
  name: 'ssot-five-axis',
  examines: ['packages', 'scripts/harness/scan-ssot-five-axis.mjs'],
};

function setDifference(left, right) {
  const other = new Set(right);
  return [...new Set(left)].filter((value) => !other.has(value)).sort();
}

export function extractRootExports(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const item of match[1].split(',')) {
      const name = item
        .trim()
        .split(/\s+as\s+/i)
        .at(-1);
      if (/^[A-Za-z_$][\w$]*$/.test(name ?? '')) names.add(name);
    }
  }
  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?(?:class|const|enum|function|interface|type)\s+([A-Za-z_$][\w$]*)/g,
  ))
    names.add(match[1]);
  return [...names].sort();
}

function publicApiSection(spec) {
  const start = spec.search(/^##\s+Public API(?: Surface)?\s*$/im);
  if (start === -1) return '';
  const rest = spec.slice(start);
  const body = rest.slice(rest.indexOf('\n') + 1);
  const next = body.search(/^##\s+(?!#)/m);
  return next === -1 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
}

export function extractPublicApiSymbols(spec) {
  const section = publicApiSection(spec);
  const symbols = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const first = (line.split('|')[1] ?? '').replaceAll('`', '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(first) && !new Set(['Name', 'Symbol', 'Type']).has(first))
      symbols.push(first);
  }
  return { section, symbols: [...new Set(symbols)].sort() };
}

export function checkPublicApiSurface(rootExports, spec) {
  if (!spec.includes('ssot:public-api-root')) return [];
  const { section, symbols } = extractPublicApiSymbols(spec);
  if (!section) return [];
  return setDifference(symbols, rootExports)
    .filter(
      (symbol) =>
        !new RegExp(
          `\\bNOTE\\b[\\s\\S]*\\b${symbol.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`,
          'i',
        ).test(section),
    )
    .map(
      (symbol) =>
        `Public API lists ${symbol}, but the package root does not export it and the section has no NOTE disclamation.`,
    );
}

export function findUndocumentedExports(addedExports, spec) {
  const documented = new Set(extractPublicApiSymbols(spec).symbols);
  return setDifference(addedExports, documented).map(
    (name) => `Added export ${name} is not documented in the Public API section.`,
  );
}

export function compareClosedSet(listed, sourceUnion) {
  return [
    ...setDifference(sourceUnion, listed).map((value) => `Closed set omits ${value}.`),
    ...setDifference(listed, sourceUnion).map(
      (value) => `Closed set lists ${value}, but the source union does not contain it.`,
    ),
  ];
}

export function compareAffectedFiles(claimed, changed) {
  return [
    ...setDifference(changed, claimed).map(
      (file) => `Changed file ${file} is absent from Affected Files.`,
    ),
    ...setDifference(claimed, changed).map(
      (file) => `Affected Files lists untouched file ${file}.`,
    ),
  ];
}

export function requirePackageSpecs(changedFiles) {
  const packages = new Set(
    changedFiles.map((file) => /^packages\/([^/]+)\/src\//.exec(file)?.[1]).filter(Boolean),
  );
  return [...packages].sort().flatMap((name) => {
    const spec = `packages/${name}/docs/SPEC.md`;
    return changedFiles.includes(spec)
      ? []
      : [`Production package ${name} changed without changing ${spec}.`];
  });
}

function tracked(glob) {
  return execFileSync('git', ['ls-files', glob], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
}

function packageInputs() {
  return tracked('packages/*/src/index.ts').flatMap((index) => {
    const name = /^packages\/([^/]+)\/src\/index\.ts$/.exec(index)?.[1];
    const specPath = name ? `packages/${name}/docs/SPEC.md` : '';
    return name && existsSync(path.join(ROOT, specPath)) ? [{ index, specPath }] : [];
  });
}

export function scanRepository() {
  const inputs = packageInputs();
  if (inputs.length === 0)
    throw new Error('ssot-five-axis: no package root/spec pairs were examined.');
  const findings = inputs.flatMap(({ index, specPath }) =>
    checkPublicApiSurface(
      extractRootExports(readFileSync(path.join(ROOT, index), 'utf8')),
      readFileSync(path.join(ROOT, specPath), 'utf8'),
    ).map((finding) => `${specPath}: ${finding}`),
  );
  const changed = process.env.SSOT_CHANGED_FILES?.split(/\s+/).filter(Boolean) ?? [];
  return { findings: [...findings, ...requirePackageSpecs(changed)], examined: inputs.length };
}

function main() {
  const result = scanRepository();
  console.log(`::examined:: ${result.examined} package SPEC/root pairs`);
  for (const finding of result.findings) console.error(`✗ ${finding}`);
  if (!result.findings.length) console.log('ssot-five-axis scan passed.');
  process.exitCode = result.findings.length ? 1 : 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
