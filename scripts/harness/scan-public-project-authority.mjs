#!/usr/bin/env node

/**
 * ARCH-042 TC-10 — public project authority must remain explicit.
 *
 * Declared scan scope:
 *
 * - production TypeScript under agent-framework, agent-session, agent-provider-replay, agent-cli,
 *   agent-command, agent-command-workflows, agent-transport, and agent-transport-tui (tests, dist,
 *   and testing helpers excluded);
 * - their published runtime barrels for public-declaration reachability and production-authority
 *   issuer reachability.
 *
 * The guard reads exported declaration structure from the TypeScript AST. It rejects a
 * project-sensitive exported declaration that accepts a bare cwd/root/path or generic filesystem
 * without a capability-bearing authority/reader/source/store, optional authority/reader members,
 * ambient Node filesystem use in such a declaration, and publication of the private authority
 * issuer/reader constructor. Explicitly named NodeHost/Node/User/Host adapters are generic host I/O
 * and are outside the project-trust claim by design. `projectAccess?` is also deliberate on the
 * high-level construction surface: absence produces the typed Restricted decision and does not
 * construct a project loader.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';

export const PROJECT_AUTHORITY_SOURCE_SCOPES = Object.freeze([
  'packages/agent-framework/src',
  'packages/agent-session/src',
  'packages/agent-provider-replay/src',
  'packages/agent-cli/src',
  'packages/agent-command/src',
  'packages/agent-command-workflows/src',
  'packages/agent-transport/src',
  'packages/agent-transport-tui/src',
]);

export const PROJECT_AUTHORITY_PUBLIC_BARRELS = Object.freeze([
  'packages/agent-framework/src/index.ts',
  'packages/agent-framework/src/testing/index.ts',
  'packages/agent-session/src/index.ts',
  'packages/agent-provider-replay/src/index.ts',
  'packages/agent-command/src/index.ts',
  'packages/agent-command-workflows/src/index.ts',
  'packages/agent-transport/src/index.ts',
  'packages/agent-transport-tui/src/index.ts',
]);

const PROJECT_SENSITIVE_NAME =
  /(Project|Workspace|TaskContext|PromptFile|AgentDefinition|Skill(Command|Source|Execution)|Checkpoint|Memory|Session(Store|Replay|Log)|Settings(Source|Store|File)|ReplayProvider)/;
const HIGH_LEVEL_PROJECT_CONSTRUCTION_NAME =
  /^(IInteractiveSession(?:Standard|Injected)?Options|IInteractiveRuntimeOptions|IAgentRuntimeConfig|ICreateQueryOptions|ICreateProgrammaticAgentOptions|IHeadlessInteractionChannelOptions|IRenderOptions|ITuiInteractionChannelOptions)$/;
const EXPLICIT_HOST_NAME = /(NodeHost|Node|User|Host)/;
const BARE_PROJECT_PATH_NAME =
  /^(cwd|root|projectRoot|worktreeRoot|baseDirectory|filePath|logFile|settingsPath)$/;
const CAPABILITY_TYPE =
  /(WorkspaceProject|WorkspaceProjectAccess|ContributionSource|SettingsSource|SettingsDocumentStore|SessionLogSource|InteractiveSessionStore)/;
const GENERIC_FILESYSTEM_TYPE = /\bIFileSystem(?:Async)?\b/;
const AMBIENT_NODE_IO =
  /\b(new\s+(?:NodeFileSystem(?:Async)?|NodeSessionStore|NodeSessionLogSource)|(?:readFileSync|writeFileSync|existsSync|readdirSync|mkdirSync|openSync|statSync|lstatSync|unlinkSync|rmSync)\s*\()/;
const PRIVATE_ISSUERS = /\b(mintWorkspaceProjectAuthority|createWorkspaceProjectReader)\b/;
const REMOVED_AMBIENT_HELPERS = new Set([
  'projectPaths',
  'getProviderSettingsPaths',
  'resolveSettingsPathForScope',
]);

let examinedFiles = 0;

export function readExaminedPublicProjectAuthorityCount() {
  return examinedFiles;
}

function isExported(node) {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function declarationName(node) {
  return node.name?.text ?? node.name?.escapedText ?? '<anonymous>';
}

function parameterFacts(parameters, sourceFile) {
  return (parameters ?? []).map((parameter) => ({
    name: parameter.name?.text ?? parameter.name?.escapedText ?? '',
    type: parameter.type?.getText?.(sourceFile) ?? '',
  }));
}

function declarationParameters(node, sourceFile) {
  if (ts.isFunctionDeclaration(node)) return parameterFacts(node.parameters, sourceFile);
  if (ts.isClassDeclaration(node)) {
    const constructor = (node.members ?? []).find(
      (member) => member.kind === ts.SyntaxKind.Constructor,
    );
    return parameterFacts(constructor?.parameters, sourceFile);
  }
  return [];
}

function finding(file, sourceFile, node, rule, detail) {
  return { file, line: lineOf(sourceFile, node), rule, detail };
}

function inspectExportedDeclaration(file, sourceFile, node) {
  const findings = [];
  const name = declarationName(node);
  if (!PROJECT_SENSITIVE_NAME.test(name) || EXPLICIT_HOST_NAME.test(name)) return findings;

  const parameters = declarationParameters(node, sourceFile);
  const hasCapability = parameters.some((parameter) => CAPABILITY_TYPE.test(parameter.type));
  const barePath = parameters.find(
    (parameter) => BARE_PROJECT_PATH_NAME.test(parameter.name) && /\bstring\b/.test(parameter.type),
  );
  if (barePath !== undefined && !hasCapability) {
    findings.push(
      finding(
        file,
        sourceFile,
        node,
        'bare-project-path',
        `${name} accepts ${barePath.name}: ${barePath.type} without project authority or a derived port.`,
      ),
    );
  }

  const genericFileSystem = parameters.find((parameter) =>
    GENERIC_FILESYSTEM_TYPE.test(parameter.type),
  );
  if (genericFileSystem !== undefined && !hasCapability) {
    findings.push(
      finding(
        file,
        sourceFile,
        node,
        'generic-filesystem-as-trust',
        `${name} accepts ${genericFileSystem.type}; a generic filesystem does not prove project trust.`,
      ),
    );
  }

  const declarationText = node.getText(sourceFile);
  if (AMBIENT_NODE_IO.test(declarationText) && !hasCapability) {
    findings.push(
      finding(
        file,
        sourceFile,
        node,
        'ambient-node-fallback',
        `${name} performs or constructs ambient Node I/O without an authority-derived port.`,
      ),
    );
  }
  return findings;
}

function inspectOptionalAuthorityMembers(file, sourceFile, node) {
  if (!ts.isInterfaceDeclaration(node) || !isExported(node)) return [];
  const findings = [];
  for (const member of node.members ?? []) {
    const name = member.name?.text ?? member.name?.escapedText ?? '';
    const optional = member.postfixToken?.kind === ts.SyntaxKind.QuestionToken;
    if (
      !optional ||
      !/^(authority|reader|projectAuthority|projectReader|workspaceAuthority|workspaceReader)$/.test(
        name,
      )
    ) {
      continue;
    }
    findings.push(
      finding(
        file,
        sourceFile,
        member,
        'optional-project-authority',
        `${declarationName(node)}.${name}? makes absence an ambient-fallback opportunity.`,
      ),
    );
  }
  return findings;
}

function inspectHighLevelProjectDecision(file, sourceFile, node) {
  if (
    !ts.isInterfaceDeclaration(node) ||
    !isExported(node) ||
    !HIGH_LEVEL_PROJECT_CONSTRUCTION_NAME.test(declarationName(node))
  ) {
    return [];
  }
  const members = (node.members ?? []).map((member) => ({
    name: member.name?.text ?? member.name?.escapedText ?? '',
    type: member.type?.getText?.(sourceFile) ?? '',
  }));
  const acceptsCwd = members.some(
    (member) => member.name === 'cwd' && /\bstring\b/.test(member.type),
  );
  const carriesProjectDecision = members.some(
    (member) => member.name === 'projectAccess' && /\bTWorkspaceProjectAccess\b/.test(member.type),
  );
  if (!acceptsCwd || carriesProjectDecision) return [];
  return [
    finding(
      file,
      sourceFile,
      node,
      'high-level-project-decision-missing',
      `${declarationName(node)} accepts cwd but cannot carry the host's trusted-or-restricted project decision.`,
    ),
  ];
}

export function findPublicProjectAuthorityFindings(
  files,
  publicBarrels,
  readFile = (file) => readFileSync(file, 'utf8'),
) {
  examinedFiles = new Set(files).size;
  const barrelSet = new Set(publicBarrels);
  const findings = [];
  const publicNames = new Set();

  for (const barrel of barrelSet) {
    const content = readFile(barrel);
    const sourceFile = ts.createSourceFile(barrel, content);
    for (const statement of sourceFile.statements ?? []) {
      if (isExported(statement) && declarationName(statement) !== '<anonymous>') {
        publicNames.add(declarationName(statement));
      }
      if (!ts.isExportDeclaration(statement)) continue;
      for (const element of statement.exportClause?.elements ?? []) {
        const name = element.name?.text ?? element.name?.escapedText;
        if (name) publicNames.add(name);
      }
    }
  }

  for (const file of new Set(files)) {
    const content = readFile(file);
    const sourceFile = ts.createSourceFile(file, content);
    if (barrelSet.has(file) && PRIVATE_ISSUERS.test(content)) {
      findings.push({
        file,
        line: 1,
        rule: 'production-authority-issuer-exported',
        detail: 'A published production/testing barrel exposes a private project-authority issuer.',
      });
    }

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const called = node.expression?.text ?? node.expression?.name?.text;
        if (REMOVED_AMBIENT_HELPERS.has(called)) {
          findings.push(
            finding(
              file,
              sourceFile,
              node,
              'removed-ambient-helper-call',
              `${called}(...) reconstructs project authority from a path.`,
            ),
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    for (const statement of sourceFile.statements ?? []) {
      if (publicNames.has(declarationName(statement))) {
        findings.push(...inspectOptionalAuthorityMembers(file, sourceFile, statement));
        findings.push(...inspectHighLevelProjectDecision(file, sourceFile, statement));
      }
      if (
        publicNames.has(declarationName(statement)) &&
        isExported(statement) &&
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      ) {
        findings.push(...inspectExportedDeclaration(file, sourceFile, statement));
      }
    }
  }
  return findings;
}

function collectProductionTypeScript(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'dist' || entry.name === '__tests__' || entry.name === 'testing') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
    }
  };
  for (const scope of PROJECT_AUTHORITY_SOURCE_SCOPES) walk(path.join(root, scope));
  for (const barrel of PROJECT_AUTHORITY_PUBLIC_BARRELS) files.push(path.join(root, barrel));
  return [...new Set(files)];
}

function main() {
  const root = process.cwd();
  requireGovernedTree(root, PROJECT_AUTHORITY_SOURCE_SCOPES, {
    scan: 'public-project-authority',
    why: 'ARCH-042 explicitly governs these runtime project API and consumer packages.',
  });
  const files = collectProductionTypeScript(root);
  const barrels = PROJECT_AUTHORITY_PUBLIC_BARRELS.map((file) => path.join(root, file));
  const findings = findPublicProjectAuthorityFindings(files, barrels);

  process.stdout.write(
    `::examined:: ${readExaminedPublicProjectAuthorityCount()} TypeScript file(s)\n`,
  );
  if (findings.length === 0) {
    process.stdout.write('public-project-authority scan passed.\n');
    return;
  }
  process.stderr.write(`public-project-authority scan: FINDINGS (${findings.length})\n`);
  for (const entry of findings) {
    process.stderr.write(
      `- [${entry.rule}] ${path.relative(root, entry.file)}:${entry.line}: ${entry.detail}\n`,
    );
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
