import { promises as fs } from 'node:fs';
import path from 'node:path';

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
const SKILLS_ROOT = path.join(WORKSPACE_ROOT, '.agents', 'skills');

const PHRASE_CHECKS = [
  {
    id: 'undefined-path-only',
    pattern: /\bPath-Only\b/,
    message: 'Undefined rule-level terminology "Path-Only" should not appear.',
    ignoreLineIncludes: ['rg -n'],
  },
  {
    id: 'reversed-dependency-direction',
    pattern: /Lower layers import from higher layers, not the other way around\./,
    message: 'Dependency direction guidance is reversed.',
  },
  {
    id: 'implicit-failed-retry',
    pattern: /failed:RETRY/,
    message: 'Default state machine examples must not model implicit failed -> retry transitions.',
  },
  {
    id: 'legacy-unknown-ban',
    pattern: /do not use `any`, `unknown`, or `\{\}` in production code\./,
    message: 'Legacy type rule contradicts current trust-boundary policy for unknown.',
  },
  {
    id: 'unchecked-example-cast',
    pattern: /obj as ITaskRunPayload/,
    message: 'Boundary examples must not teach unchecked casts into owned payload types.',
  },
];

const REQUIRED_ROOT_HARNESS_SCRIPTS = [
  'harness:scan',
  'harness:scan:consistency',
  'harness:scan:specs',
  'harness:verify',
  'harness:record',
  'harness:review',
  'harness:self-check',
];

function extractSections(content) {
  return new Set([...content.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1].trim()));
}

function extractAnchors(content) {
  return [...content.matchAll(/`AGENTS\.md` > "([^"]+)"/g)].map((match) => match[1]);
}

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

function relativePath(targetPath) {
  return path.relative(WORKSPACE_ROOT, targetPath);
}

async function main() {
  const findings = [];
  const agentsContent = await fs.readFile(AGENTS_PATH, 'utf8');
  const sections = extractSections(agentsContent);

  // Also collect sections from all rule files linked from AGENTS.md
  const rulesDir = path.join(WORKSPACE_ROOT, '.agents', 'rules');
  try {
    const ruleEntries = await fs.readdir(rulesDir, { withFileTypes: true });
    for (const entry of ruleEntries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const ruleContent = await fs.readFile(path.join(rulesDir, entry.name), 'utf8');
        for (const section of extractSections(ruleContent)) {
          sections.add(section);
        }
      }
    }
  } catch {
    // rules directory missing — skip
  }
  const skillFiles = await listSkillFiles();
  const rootPackageJson = await readJson(ROOT_PACKAGE_JSON_PATH);
  const rootScripts =
    typeof rootPackageJson.scripts === 'object' && rootPackageJson.scripts !== null
      ? rootPackageJson.scripts
      : {};
  const workspacePatterns = await readWorkspacePatterns();
  const scopes = await listWorkspaceScopes();

  const rootWorkspaces = Array.isArray(rootPackageJson.workspaces)
    ? rootPackageJson.workspaces
    : [];
  if (rootWorkspaces.join('\n') !== workspacePatterns.join('\n')) {
    findings.push({
      file: 'package.json',
      type: 'workspace-drift',
      detail: 'package.json workspaces must stay aligned with pnpm-workspace.yaml patterns.',
    });
  }

  for (const scriptName of REQUIRED_ROOT_HARNESS_SCRIPTS) {
    if (!rootScripts[scriptName]) {
      findings.push({
        file: 'package.json',
        type: 'missing-root-harness-script',
        detail: `Root package.json must expose ${scriptName}.`,
      });
    }
  }

  for (const skillFile of skillFiles) {
    const content = await fs.readFile(skillFile, 'utf8');
    const anchors = extractAnchors(content);
    const lines = content.split(/\r?\n/);

    for (const anchor of anchors) {
      if (!sections.has(anchor)) {
        findings.push({
          file: relativePath(skillFile),
          type: 'missing-anchor',
          detail: `Missing AGENTS anchor: ${anchor}`,
        });
      }
    }

    for (const check of PHRASE_CHECKS) {
      for (const line of lines) {
        if (!check.pattern.test(line)) {
          continue;
        }
        if (
          check.ignoreLineIncludes &&
          check.ignoreLineIncludes.some((value) => line.includes(value))
        ) {
          continue;
        }
        findings.push({
          file: relativePath(skillFile),
          type: check.id,
          detail: check.message,
        });
        break;
      }
    }
  }

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

void main();
