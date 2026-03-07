import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { listWorkspaceScopes, pathExists, readJson, readText } from './shared.mjs';

const WORKSPACE_ROOT = process.cwd();
const AGENTS_PATH = path.join(WORKSPACE_ROOT, 'AGENTS.md');
const SKILLS_ROOT = path.join(WORKSPACE_ROOT, '.agents', 'skills');
const DESIGN_TMP_PATH = path.join(WORKSPACE_ROOT, '.design', 'tmp');

const SPEC_REQUIRED_SECTIONS = [
  'Scope',
  'Boundaries',
  'Architecture Overview',
  'Type Ownership',
  'Public API Surface',
  'Extension Points',
  'Error Taxonomy',
  'Test Strategy',
];

const FORBIDDEN_AGENT_TERMS = [
  /\bmain agent\b/i,
  /\bsub-agent\b/i,
  /\bparent-agent\b/i,
  /\bchild-agent\b/i,
];

function relativePath(targetPath) {
  return path.relative(WORKSPACE_ROOT, targetPath);
}

function extractSections(content) {
  return [...content.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => match[1].trim());
}

async function listSkillDirs() {
  const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function extractSkillsFromAgents(content) {
  const names = new Set();
  for (const match of content.matchAll(/\|\s*(\S+)\s*\|\s*`\.agents\/skills\/\1\/`\s*\|/g)) {
    names.add(match[1]);
  }
  return names;
}

async function checkStaleDesignDocs(findings) {
  if (!(await pathExists(DESIGN_TMP_PATH))) {
    return;
  }

  const entries = await fs.readdir(DESIGN_TMP_PATH);
  const mdFiles = entries.filter((name) => name.endsWith('.md'));

  for (const file of mdFiles) {
    const fullPath = path.join(DESIGN_TMP_PATH, file);
    const stat = await fs.stat(fullPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

    if (ageDays > 14) {
      findings.push({
        file: `.design/tmp/${file}`,
        type: 'stale-tmp-doc',
        detail: `Temporary design document is ${ageDays} days old. Consider promoting to owner doc or removing.`,
      });
    }
  }
}

async function checkSpecQuality(findings) {
  const scopes = await listWorkspaceScopes();

  for (const scope of scopes) {
    const specPath = path.join(WORKSPACE_ROOT, scope.relativeDir, 'docs', 'SPEC.md');
    if (!(await pathExists(specPath))) {
      continue;
    }

    const content = await readText(specPath);
    const sections = extractSections(content);
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (lines.length < 10) {
      findings.push({
        file: path.join(scope.relativeDir, 'docs', 'SPEC.md'),
        type: 'minimal-spec',
        detail: `SPEC.md has only ${lines.length} non-empty lines. Consider expanding per spec-writing-standard skill.`,
      });
    }

    const missingSections = SPEC_REQUIRED_SECTIONS.filter(
      (required) => !sections.some((section) => section.includes(required))
    );

    if (missingSections.length > 0) {
      findings.push({
        file: path.join(scope.relativeDir, 'docs', 'SPEC.md'),
        type: 'spec-missing-sections',
        detail: `Missing required sections: ${missingSections.join(', ')}`,
      });
    }
  }
}

async function checkUnregisteredSkills(findings) {
  const agentsContent = await readText(AGENTS_PATH);
  const registeredSkills = extractSkillsFromAgents(agentsContent);
  const skillDirs = await listSkillDirs();

  for (const skillDir of skillDirs) {
    if (!registeredSkills.has(skillDir)) {
      findings.push({
        file: `.agents/skills/${skillDir}/`,
        type: 'unregistered-skill',
        detail: `Skill directory exists but is not listed in AGENTS.md Skills Reference table.`,
      });
    }
  }

  for (const registered of registeredSkills) {
    if (!skillDirs.includes(registered)) {
      findings.push({
        file: 'AGENTS.md',
        type: 'stale-skill-reference',
        detail: `AGENTS.md references skill "${registered}" but no directory exists at .agents/skills/${registered}/.`,
      });
    }
  }
}

async function checkForbiddenTerms(findings) {
  const scopes = await listWorkspaceScopes();

  for (const scope of scopes) {
    const srcDir = path.join(WORKSPACE_ROOT, scope.relativeDir, 'src');
    if (!(await pathExists(srcDir))) {
      continue;
    }

    const result = spawnSync('grep', ['-rl', '-E', 'main agent|sub-agent|parent-agent|child-agent', '--include=*.ts', srcDir], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    });

    if (result.status === 0 && result.stdout.trim().length > 0) {
      const files = result.stdout.trim().split(/\r?\n/);
      for (const file of files) {
        const content = await readText(file);
        for (const term of FORBIDDEN_AGENT_TERMS) {
          if (term.test(content)) {
            findings.push({
              file: relativePath(file),
              type: 'forbidden-agent-term',
              detail: `Contains forbidden agent hierarchy term matching: ${term.source}`,
            });
            break;
          }
        }
      }
    }
  }
}

async function checkDependencyDirection(findings) {
  const scopes = await listWorkspaceScopes();
  const dagScopes = scopes.filter((scope) => scope.relativeDir.startsWith('packages/dag-') && scope.shortName !== 'dag-core');

  for (const scope of dagScopes) {
    const pkgJsonPath = path.join(WORKSPACE_ROOT, scope.relativeDir, 'package.json');
    if (!(await pathExists(pkgJsonPath))) {
      continue;
    }

    const pkgJson = await readJson(pkgJsonPath);
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
      ...pkgJson.peerDependencies,
    };

    for (const depName of Object.keys(allDeps)) {
      if (!depName.startsWith('@robota-sdk/dag-')) {
        continue;
      }

      const depShortName = depName.replace('@robota-sdk/', '');
      if (depShortName === 'dag-core') {
        continue;
      }

      if (['dag-api', 'dag-designer', 'dag-scheduler', 'dag-server-core'].includes(scope.shortName)) {
        continue;
      }

      findings.push({
        file: path.join(scope.relativeDir, 'package.json'),
        type: 'dag-sibling-dependency',
        detail: `${scope.workspaceName} depends on sibling ${depName}. DAG packages should depend only on dag-core.`,
      });
    }
  }
}

async function checkDynamicImports(findings) {
  const result = spawnSync('grep', [
    '-rn', '--include=*.ts',
    '-E', 'await import\\(|= import\\(',
    'packages/',
  ], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return;
  }

  const lines = result.stdout.trim().split(/\r?\n/);
  for (const line of lines) {
    if (line.includes('.test.') || line.includes('.spec.') || line.includes('__tests__')) {
      continue;
    }

    findings.push({
      file: line.split(':')[0],
      type: 'dynamic-import',
      detail: `Dynamic import detected. Verify this is for an optional module with explicit error handling.`,
    });
  }
}

async function main() {
  const findings = [];

  await Promise.all([
    checkStaleDesignDocs(findings),
    checkSpecQuality(findings),
    checkUnregisteredSkills(findings),
    checkForbiddenTerms(findings),
    checkDependencyDirection(findings),
    checkDynamicImports(findings),
  ]);

  findings.sort((a, b) => a.type.localeCompare(b.type) || a.file.localeCompare(b.file));

  const driftCount = findings.length;
  const typeGroups = new Map();
  for (const finding of findings) {
    const count = typeGroups.get(finding.type) ?? 0;
    typeGroups.set(finding.type, count + 1);
  }

  process.stdout.write(`harness cleanup drift scan: ${driftCount} finding(s)\n`);

  if (driftCount === 0) {
    process.stdout.write('no drift detected.\n');
    return;
  }

  process.stdout.write('\nsummary:\n');
  for (const [type, count] of typeGroups) {
    process.stdout.write(`  ${type}: ${count}\n`);
  }

  process.stdout.write('\ndetails:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
}

void main();
