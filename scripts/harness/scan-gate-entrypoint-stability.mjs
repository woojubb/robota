#!/usr/bin/env node

/**
 * Keep gate.mjs a stable compatibility boundary (INFRA-2618).
 *
 * The facade is intentionally frozen after the one-time migration that introduces this scan. The
 * implementation may evolve behind it, but a feature change must not redefine the shared CLI
 * entrypoint or its public export boundary. The baseline is data, so this scan can refuse both a
 * one-byte facade edit and a forged baseline without teaching every feature task about the rule.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { envWithoutGitVars, resolveWorkspaceRoot } from './shared.mjs';

export const FACADE_PATH = 'scripts/harness/gate.mjs';
export const BASELINE_PATH = 'scripts/harness/gate-entrypoint-baseline.json';
const ROOT = resolveWorkspaceRoot(import.meta);

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function stableFacadeShape(text) {
  const source = String(text ?? '');
  const lines = source.split('\n').filter((line) => line.trim() !== '');
  const forbidden = [
    /export\s+(?:async\s+)?function\s+/,
    /(?:const|let|var)\s+JUDGEMENTS\b/,
    /(?:const|let|var)\s+USAGE\b/,
    /\b(?:runJudge|runRecord|runAdvance|runApprove)\s*\(/,
    /writeFileSync\s*\(/,
  ];
  return (
    lines.length <= 20 &&
    source.includes("export * from './gate-public-api.mjs';") &&
    source.includes("export { main } from './gate-cli.mjs';") &&
    source.includes("import { main } from './gate-cli.mjs';") &&
    source.includes('process.argv[1]') &&
    !forbidden.some((pattern) => pattern.test(source))
  );
}

function parseBaseline(text) {
  try {
    const value = JSON.parse(String(text));
    if (
      value?.schemaVersion !== 1 ||
      value.facadePath !== FACADE_PATH ||
      typeof value.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.sha256)
    ) {
      return { ok: false, error: 'baseline schema or digest is invalid' };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: `baseline is not valid JSON: ${error.message}` };
  }
}

export function evaluateStability({ facadeText, baselineText, changedPaths = [], baseHasBaseline }) {
  const findings = [];
  if (facadeText === null) findings.push(`${FACADE_PATH} is missing`);
  else if (!stableFacadeShape(facadeText)) findings.push(`${FACADE_PATH} is not a stable facade`);

  const baseline = parseBaseline(baselineText);
  if (!baseline.ok) findings.push(baseline.error);
  else if (facadeText !== null && baseline.value.sha256 !== sha256(facadeText))
    findings.push(`${FACADE_PATH} digest differs from the frozen baseline`);

  const touchedFacade = changedPaths.includes(FACADE_PATH);
  const touchedBaseline = changedPaths.includes(BASELINE_PATH);
  if (baseHasBaseline && (touchedFacade || touchedBaseline)) {
    findings.push(
      `${FACADE_PATH} and ${BASELINE_PATH} are frozen after migration; feature changes must use the delegated modules`,
    );
  } else if (!baseHasBaseline && (!touchedFacade || !touchedBaseline)) {
    findings.push(
      `one-time migration must introduce ${FACADE_PATH} and ${BASELINE_PATH} together before the facade can be frozen`,
    );
  }
  return findings;
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: envWithoutGitVars(),
  });
  return result.status === 0 ? result.stdout : null;
}

function changedPathsSince(base) {
  const output = git(['diff', '--name-only', `${base}...HEAD`, '--']);
  return output === null ? [] : output.split('\n').filter(Boolean);
}

function baseHasBaseline(base) {
  return git(['cat-file', '-e', `${base}:${BASELINE_PATH}`]) !== null;
}

export function main() {
  const facadeText = readText(path.join(ROOT, FACADE_PATH));
  const baselineText = readText(path.join(ROOT, BASELINE_PATH));
  const base = process.env.HARNESS_BASE_REF ?? 'origin/develop';
  const changedPaths = changedPathsSince(base);
  const findings = evaluateStability({
    facadeText,
    baselineText,
    changedPaths,
    baseHasBaseline: baseHasBaseline(base),
  });
  process.stdout.write(
    findings.length === 0
      ? `gate-entrypoint-stability scan passed (${FACADE_PATH} frozen).\n`
      : `gate-entrypoint-stability scan failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}\n`,
  );
  return findings.length === 0 ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
