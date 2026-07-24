/**
 * Harness consistency scan — five independent, clearly-named responsibilities
 * (split from a single 394-line grab-bag, HARNESS-DIET-003; ZERO semantic change):
 *
 *   1. `checkWorkspaceAlignment`      — package.json `workspaces` ⟷ pnpm-workspace.yaml drift.
 *   2. `checkRequiredRootScripts`     — root package.json must expose the required harness scripts.
 *   3. `collectSkillGuidanceFindings` — per-skill AGENTS anchors (`checkSkillAnchors`) +
 *                                       skill phrase blocklist (`checkSkillPhrases`).
 *   4. `collectGuidancePhraseFindings`— guidance-doc terminology blocklist over
 *                                       AGENTS.md/rules/skills/backlog markdown.
 *   5. `collectScenarioRecordFindings`— examples/-owning workspaces must expose scenario
 *                                       scripts and keep valid, owner-matched record artifacts.
 *
 * The Robota-specific POLICY DATA (required script names, phrase blocklists, guidance scan
 * targets) lives in `.agents/harness.config.json` under the `consistency` key (HARNESS-020
 * externalization pattern); this file is the repo-agnostic engine.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import {
  listScenarioRecordArtifacts,
  readScenarioRecordArtifact,
  relativePathFromRoot,
  renderCommand,
  validateScenarioRecordArtifact,
} from './scenario-records.mjs';
import { resolveScenarioVerification } from './scenario-owner-map.mjs';
import { listWorkspaceScopes, pathExists, readJson, readWorkspacePatterns } from './shared.mjs';

const WORKSPACE_ROOT = process.cwd();
const AGENTS_PATH = path.join(WORKSPACE_ROOT, 'AGENTS.md');
const ROOT_PACKAGE_JSON_PATH = path.join(WORKSPACE_ROOT, 'package.json');
const RULES_ROOT = path.join(WORKSPACE_ROOT, '.agents', 'rules');
const SKILLS_ROOT = path.join(WORKSPACE_ROOT, '.agents', 'skills');

const CONSISTENCY = loadHarnessConfig().consistency;

/** Compile a config phrase-check entry (`pattern` source + optional `flags`) into a RegExp. */
function compilePhraseChecks(checks) {
  return checks.map((check) => ({
    ...check,
    regex: new RegExp(check.pattern, check.flags ?? ''),
  }));
}

// ---------------------------------------------------------------------------
// Responsibility 1: workspace declaration drift
// ---------------------------------------------------------------------------

/** package.json `workspaces` must stay aligned with pnpm-workspace.yaml patterns. */
export function checkWorkspaceAlignment(rootPackageJson, workspacePatterns) {
  const rootWorkspaces = Array.isArray(rootPackageJson.workspaces)
    ? rootPackageJson.workspaces
    : [];
  if (rootWorkspaces.join('\n') === workspacePatterns.join('\n')) return [];
  return [
    {
      file: 'package.json',
      type: 'workspace-drift',
      detail: 'package.json workspaces must stay aligned with pnpm-workspace.yaml patterns.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Responsibility 2: required root harness scripts
// ---------------------------------------------------------------------------

/** Root package.json must expose every required harness script. */
export function checkRequiredRootScripts(rootScripts, requiredScripts) {
  const findings = [];
  for (const scriptName of requiredScripts) {
    if (!rootScripts[scriptName]) {
      findings.push({
        file: 'package.json',
        type: 'missing-root-harness-script',
        detail: `Root package.json must expose ${scriptName}.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Responsibility 3: skill guidance (AGENTS anchors + skill phrase blocklist)
// ---------------------------------------------------------------------------

function extractSections(content) {
  return new Set([...content.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1].trim()));
}

function extractAnchors(content) {
  return [...content.matchAll(/`AGENTS\.md` > "([^"]+)"/g)].map((match) => match[1]);
}

/** Every `AGENTS.md > "…"` anchor a skill cites must exist as an AGENTS/rules section. */
export function checkSkillAnchors(content, sections, file) {
  const findings = [];
  for (const anchor of extractAnchors(content)) {
    if (!sections.has(anchor)) {
      findings.push({
        file,
        type: 'missing-anchor',
        detail: `Missing AGENTS anchor: ${anchor}`,
      });
    }
  }
  return findings;
}

/** Skill files must not contain a blocklisted phrase (one finding per file+check). */
export function checkSkillPhrases(lines, phraseChecks, file) {
  const findings = [];
  for (const check of phraseChecks) {
    for (const line of lines) {
      if (!check.regex.test(line)) {
        continue;
      }
      if (
        check.ignoreLineIncludes &&
        check.ignoreLineIncludes.some((value) => line.includes(value))
      ) {
        continue;
      }
      findings.push({
        file,
        type: check.id,
        detail: check.message,
      });
      break;
    }
  }
  return findings;
}

/** Per skill file (in sorted order): anchor findings, then phrase findings. */
export async function collectSkillGuidanceFindings(skillFiles, sections, phraseChecks) {
  const findings = [];
  for (const skillFile of skillFiles) {
    const content = await fs.readFile(skillFile, 'utf8');
    const file = relativePath(skillFile);
    findings.push(...checkSkillAnchors(content, sections, file));
    findings.push(...checkSkillPhrases(content.split(/\r?\n/), phraseChecks, file));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Responsibility 4: guidance-doc terminology blocklist
// ---------------------------------------------------------------------------

/** Guidance markdown (AGENTS/rules/skills/backlog) must use canonical terminology. */
export async function collectGuidancePhraseFindings(guidanceFiles, guidanceChecks) {
  const findings = [];
  for (const guidanceFile of guidanceFiles) {
    const content = await fs.readFile(guidanceFile, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const check of guidanceChecks) {
      for (const line of lines) {
        if (!check.regex.test(line)) {
          continue;
        }
        findings.push({
          file: relativePath(guidanceFile),
          type: check.id,
          detail: check.message,
        });
        break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Responsibility 5: scenario-record conformance for examples/-owning workspaces
// ---------------------------------------------------------------------------

/**
 * A workspace that owns `examples/` must expose scenario:verify / scenario:record scripts and
 * keep authoritative, valid, owner-command-matched record artifacts under examples/scenarios/.
 */
export async function collectScenarioRecordFindings(scopes) {
  const findings = [];
  for (const scope of scopes) {
    const examplesPath = path.join(WORKSPACE_ROOT, scope.relativeDir, 'examples');
    if (!(await pathExists(examplesPath))) {
      continue;
    }

    if (!scope.scripts['scenario:verify']) {
      findings.push({
        file: path.join(scope.relativeDir, 'package.json'),
        type: 'missing-scenario-verify-script',
        detail:
          'Workspace owns examples/ but does not expose a package-level scenario:verify command.',
      });
    }

    if (!scope.scripts['scenario:record']) {
      findings.push({
        file: path.join(scope.relativeDir, 'package.json'),
        type: 'missing-scenario-record-script',
        detail:
          'Workspace owns examples/ but does not expose a package-level scenario:record command.',
      });
    }

    const recordArtifacts = await listScenarioRecordArtifacts(scope.relativeDir);
    const scenariosPath = path.join(examplesPath, 'scenarios');
    if (!(await pathExists(scenariosPath))) {
      findings.push({
        file: path.join(scope.relativeDir, 'examples'),
        type: 'missing-scenario-record-artifacts',
        detail:
          'Workspace owns examples/ but does not keep authoritative records under examples/scenarios/*.record.json.',
      });
      continue;
    }

    if (recordArtifacts.length === 0) {
      findings.push({
        file: path.join(scope.relativeDir, 'examples', 'scenarios'),
        type: 'missing-scenario-record-artifacts',
        detail:
          'Workspace owns examples/ but does not keep authoritative records under examples/scenarios/*.record.json.',
      });
      continue;
    }

    const scenarioVerification = resolveScenarioVerification(scope);
    const artifactCommands = new Set();

    for (const artifactPath of recordArtifacts) {
      const record = await readScenarioRecordArtifact(artifactPath);
      const validationFindings = validateScenarioRecordArtifact(record, scope.relativeDir);
      for (const detail of validationFindings) {
        findings.push({
          file: relativePathFromRoot(artifactPath),
          type: 'invalid-scenario-record-artifact',
          detail,
        });
      }

      if (typeof record.command?.rendered === 'string' && record.command.rendered.length > 0) {
        if (artifactCommands.has(record.command.rendered)) {
          findings.push({
            file: relativePathFromRoot(artifactPath),
            type: 'duplicate-scenario-record-command',
            detail: `Duplicate scenario record command mapping for ${record.command.rendered}.`,
          });
        } else {
          artifactCommands.add(record.command.rendered);
        }
      }
    }

    if (!scenarioVerification) {
      continue;
    }

    const expectedCommands = scenarioVerification.commands.map((command) =>
      renderCommand(command.command, command.args),
    );
    if (recordArtifacts.length !== expectedCommands.length) {
      findings.push({
        file: path.join(scope.relativeDir, 'examples', 'scenarios'),
        type: 'scenario-record-command-count-mismatch',
        detail: `Expected ${expectedCommands.length} scenario record artifact(s) to match owner scenario commands, found ${recordArtifacts.length}.`,
      });
    }

    for (const expectedCommand of expectedCommands) {
      if (!artifactCommands.has(expectedCommand)) {
        findings.push({
          file: path.join(scope.relativeDir, 'examples', 'scenarios'),
          type: 'missing-scenario-record-command',
          detail: `No authoritative scenario record artifact matches owner command: ${expectedCommand}.`,
        });
      }
    }

    for (const artifactCommand of artifactCommands) {
      if (!expectedCommands.includes(artifactCommand)) {
        findings.push({
          file: path.join(scope.relativeDir, 'examples', 'scenarios'),
          type: 'unexpected-scenario-record-command',
          detail: `Authoritative scenario record artifact is not owned by the current scenario command set: ${artifactCommand}.`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Shared input loading + composition
// ---------------------------------------------------------------------------

async function listSkillFiles() {
  const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  const skillFiles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
    try {
      await fs.access(skillPath);
      skillFiles.push(skillPath);
    } catch {
      continue;
    }
  }

  return skillFiles.sort();
}

async function listMarkdownFilesRecursive(targetPath) {
  const absPath = path.join(WORKSPACE_ROOT, targetPath);
  if (!(await pathExists(absPath))) {
    return [];
  }

  const stat = await fs.stat(absPath);
  if (stat.isFile()) {
    return targetPath.endsWith('.md') ? [absPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const entries = await fs.readdir(absPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childTarget = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFilesRecursive(childTarget)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(WORKSPACE_ROOT, childTarget));
    }
  }

  return files.sort();
}

function relativePath(targetPath) {
  return path.relative(WORKSPACE_ROOT, targetPath);
}

/** AGENTS.md `##`/`###` sections plus the sections of every linked rules document. */
async function collectAnchorSections() {
  const sections = extractSections(await fs.readFile(AGENTS_PATH, 'utf8'));
  try {
    const ruleEntries = await fs.readdir(RULES_ROOT, { withFileTypes: true });
    for (const entry of ruleEntries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const ruleContent = await fs.readFile(path.join(RULES_ROOT, entry.name), 'utf8');
        for (const section of extractSections(ruleContent)) {
          sections.add(section);
        }
      }
    }
  } catch {
    // rules directory missing — skip
  }
  return sections;
}

async function main() {
  const sections = await collectAnchorSections();
  const skillFiles = await listSkillFiles();
  const guidanceFiles = (
    await Promise.all(
      CONSISTENCY.guidancePhraseScanTargets.map((target) => listMarkdownFilesRecursive(target)),
    )
  )
    .flat()
    .sort();
  const rootPackageJson = await readJson(ROOT_PACKAGE_JSON_PATH);
  const rootScripts =
    typeof rootPackageJson.scripts === 'object' && rootPackageJson.scripts !== null
      ? rootPackageJson.scripts
      : {};
  const workspacePatterns = await readWorkspacePatterns();
  const scopes = await listWorkspaceScopes();

  const findings = [
    ...checkWorkspaceAlignment(rootPackageJson, workspacePatterns),
    ...checkRequiredRootScripts(rootScripts, CONSISTENCY.requiredRootScripts),
    ...(await collectSkillGuidanceFindings(
      skillFiles,
      sections,
      compilePhraseChecks(CONSISTENCY.skillPhraseChecks),
    )),
    ...(await collectGuidancePhraseFindings(
      guidanceFiles,
      compilePhraseChecks(CONSISTENCY.guidancePhraseChecks),
    )),
    ...(await collectScenarioRecordFindings(scopes)),
  ];

  if (findings.length === 0) {
    process.stdout.write('harness consistency scan passed.\n');
    return;
  }

  process.stdout.write('harness consistency scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  void main();
}
