#!/usr/bin/env node
/**
 * Relation-level guard for #2726 / retained #2295. Declarations are read from TypeScript ASTs;
 * only intentional non-session dispositions and the modelId rename are written by hand here.
 * Every declared source field must either cross its next edge or have an explicit disposition.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from './lib/ts-ast.mjs';
import { declaredFields } from './scan-preset-projection.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

export const SOURCE_FILES = Object.freeze({
  render: 'packages/agent-ui-terminal/src/render.tsx',
  cli: 'packages/agent-cli/src/cli.ts',
  tuiChannel: 'packages/agent-ui-terminal/src/tui-channel-options.ts',
  tuiSession: 'packages/agent-ui-terminal/src/tui-session-options.ts',
  print: 'packages/agent-cli/src/modes/print-mode.ts',
  headless: 'packages/agent-framework/src/transport-host/headless/HeadlessInteractionChannel.ts',
  serve: 'packages/agent-cli/src/modes/serve-mode.ts',
  presetSurface: 'packages/agent-cli/src/startup/preset-surface-options.ts',
  presetSessionFields: 'packages/agent-cli/src/startup/preset-session-fields.ts',
  cliArgs: 'packages/agent-cli/src/utils/cli-args.ts',
  memory: 'packages/agent-cli/src/startup/memory-enablement.ts',
  sessionOptions: 'packages/agent-framework/src/interactive/interactive-session-options.ts',
});

// These fields belong to rendering, channel lifecycle, or server presentation. Each exclusion is
// specific to one edge; a new interface member gets no implicit exemption.
const EXCLUSIONS = {
  'render→channel': new Set([
    'providerOverride',
    'providerType',
    'version',
    'showSessionPickerOnStart',
    'initialInput',
    'initialInputOrigin',
    'startupUpdateNotice',
    'cliAdapter',
    'onChannelReady',
    'screenReaderChannel',
    'screenReaderHint',
    'keybindingsSource',
    'themeRegistry',
    'reducedMotion',
    'reducedMotionOverride',
    'focusReporting',
    'promptHistorySource',
    'promptHistoryProject',
  ]),
  'channel→session': new Set([
    'onAutoNamed',
    'transportRegistry',
    'reloadPluginCommandSource',
    'attention',
    'onSessionEventDeliveryError',
    'screenReader',
  ]),
  'print→headless': new Set(['shellExec']), // supplied by HeadlessInteractionChannel itself
  'headless→session': new Set(['outputFormat', 'effortResolution']),
  'serve→session': new Set(['args', 'preset', 'transportRegistry', 'getMonitorWsUrl']),
};

let examinedRelationGroups = 0;

export function readExaminedSessionCapabilityRelationCount() {
  return examinedRelationGroups;
}

function member(node) {
  return node?.name?.text;
}

function objectFor(source, file, selector) {
  const ast = ts.createSourceFile(file, source);
  let object;
  const visit = (node) => {
    if (object) return;
    if (selector(node, ast)) {
      if (ts.isCallExpression(node) || node.kind === ts.SyntaxKind.NewExpression) {
        object = node.arguments?.find(ts.isObjectLiteralExpression);
      } else {
        const findReturn = (child) => {
          if (object) return;
          if (
            child.kind === ts.SyntaxKind.ReturnStatement &&
            ts.isObjectLiteralExpression(child.expression)
          ) {
            object = child.expression;
            return;
          }
          child.forEachChild(findReturn);
        };
        node.body?.forEachChild(findReturn);
      }
      return;
    }
    node.forEachChild(visit);
  };
  visit(ast);
  if (!object) throw new Error(`${file}: expected projection object is missing`);

  const edges = new Map();
  const expressions = new Map();
  const spreads = new Set();
  const add = (key, expression) => {
    const refs = edges.get(key) ?? new Set();
    const raw = expression?.getText(ast) ?? '';
    for (const match of raw.matchAll(
      /\b(?:this\.opts|options|opts|args|preset|presetOptions|toolOptions|sessionResolution|memorySessionOptions)\.([A-Za-z_$][\w$]*)\b/g,
    )) {
      refs.add(match[0]);
    }
    if (ts.isIdentifier(expression)) refs.add(expression.text);
    edges.set(key, refs);
    expressions.set(key, [...(expressions.get(key) ?? []), raw]);
  };
  const visitSpread = (expression) => {
    if (ts.isObjectLiteralExpression(expression)) return collect(expression);
    if (ts.isParenthesizedExpression(expression)) return visitSpread(expression.expression);
    if (expression.kind === ts.SyntaxKind.ConditionalExpression) {
      visitSpread(expression.whenTrue);
      visitSpread(expression.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(expression)) {
      visitSpread(expression.left);
      visitSpread(expression.right);
      return;
    }
    spreads.add(expression.getText(ast));
  };
  const collect = (literal) => {
    for (const property of literal.properties) {
      if (ts.isPropertyAssignment(property)) add(member(property), property.initializer);
      else if (property.kind === ts.SyntaxKind.ShorthandPropertyAssignment)
        add(member(property), property.name);
      else if (property.kind === ts.SyntaxKind.SpreadAssignment) visitSpread(property.expression);
    }
  };
  collect(object);
  return { edges, expressions, spreads };
}

function fields(sources, file, name, findings) {
  const result = declaredFields(sources[file], file, name);
  if (!result) {
    findings.push(`${file}: ${name} declaration is missing`);
    return [];
  }
  for (const unresolved of result.unresolved)
    findings.push(`${file}: ${name} heritage is unresolved: ${unresolved.name}`);
  return result.fields;
}

function check(
  label,
  names,
  projection,
  findings,
  { rename = {}, special = {}, sourceRoot, destinationFields } = {},
) {
  examinedRelationGroups++;
  const exclusions = EXCLUSIONS[label];
  for (const excluded of exclusions) {
    if (!names.includes(excluded)) findings.push(`${label} ${excluded}: obsolete exclusion`);
  }
  for (const name of names) {
    if (exclusions.has(name)) continue;
    const target = rename[name] ?? name;
    const suffix = target === name ? name : `${name}→${target}`;
    const expected = special[name];
    if (destinationFields && !destinationFields.includes(target) && !expected?.spread) {
      findings.push(`${label} ${suffix}: destination capability is not declared`);
      continue;
    }
    if (expected?.spread) {
      if (![...projection.spreads].some((spread) => expected.spread.test(spread))) {
        findings.push(
          `${label} ${suffix}: required spread edge is missing (saw ${[...projection.spreads].join('; ')})`,
        );
      }
      continue;
    }
    const refs = projection.edges.get(target);
    if (!refs) {
      findings.push(`${label} ${suffix}: declared capability has no mapping edge`);
      continue;
    }
    const requiredRef = expected?.ref ?? (sourceRoot ? `${sourceRoot}.${name}` : undefined);
    const exactValue = expected?.exact ?? requiredRef;
    if (exactValue && !projection.expressions.get(target)?.includes(exactValue)) {
      findings.push(`${label} ${suffix}: expected exact value ${exactValue}`);
    } else if (requiredRef && !refs.has(requiredRef)) {
      findings.push(
        `${label} ${suffix}: expected ${requiredRef}, found ${[...refs].join(', ') || 'no source reference'}`,
      );
    }
  }
}

function printPresetAliasIsDerived(source) {
  const ast = ts.createSourceFile(SOURCE_FILES.print, source);
  return ast.statements.some(
    (node) =>
      node.kind === ts.SyntaxKind.TypeAliasDeclaration &&
      node.name?.text === 'IPrintModePresetOptions' &&
      node.type?.getText(ast) === 'Partial<IPresetSurfaceOptions>',
  );
}

function servePresetAliasIsDerived(source) {
  const ast = ts.createSourceFile(SOURCE_FILES.serve, source);
  return ast.statements.some(
    (node) =>
      node.kind === ts.SyntaxKind.TypeAliasDeclaration &&
      node.name?.text === 'IServeModePresetOptions' &&
      node.type?.getText(ast) === 'Partial<IPresetSurfaceOptions>',
  );
}

function printParameterNames(source) {
  const ast = ts.createSourceFile(SOURCE_FILES.print, source);
  const fn = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'runPrintMode',
  );
  return fn?.parameters.map((parameter) => parameter.name?.text).filter(Boolean) ?? [];
}

function callArguments(source, file, name) {
  const ast = ts.createSourceFile(file, source);
  let result;
  const visit = (node) => {
    if (result) return;
    if (ts.isCallExpression(node) && node.expression.getText(ast) === name) {
      result = node.arguments.map((argument) => argument.getText(ast));
      return;
    }
    node.forEachChild(visit);
  };
  visit(ast);
  if (!result) throw new Error(`${file}: ${name} call is missing`);
  return result;
}

function presetFieldsRemovedFromRest(source) {
  const ast = ts.createSourceFile(SOURCE_FILES.presetSurface, source);
  const fn = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'toSessionOptions',
  );
  if (!fn) throw new Error('preset→render: toSessionOptions declaration is missing');
  let binding;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer?.getText(ast) === 'surface'
    ) {
      binding = node.name;
    }
    node.forEachChild(visit);
  };
  fn.body?.forEachChild(visit);
  if (!binding || !binding.elements.some((element) => element.dotDotDotToken)) {
    throw new Error('preset→render: source destructuring with rest is missing');
  }
  return new Set(
    binding.elements
      .filter((element) => !element.dotDotDotToken)
      .map((element) => (element.propertyName ?? element.name).text),
  );
}

function checkPrintSource(
  root,
  names,
  headless,
  projection,
  findings,
  { rename = {}, helper } = {},
) {
  const helperProjection = helper?.projection;
  for (const name of names) {
    const target = rename[name] ?? name;
    const label = `print source ${root}.${name}`;
    if (!headless.includes(target)) {
      findings.push(`${label}: ${target} is not declared on headless channel`);
      continue;
    }
    if (helper?.fields?.includes(name)) {
      if (!projection.spreads.has('presetSessionFields(presetOptions)')) {
        findings.push(`${label}: presetSessionFields spread is missing`);
      }
      if (!helperProjection.expressions.get(target)?.includes(`preset.${name}`)) {
        findings.push(`${label}: helper does not map preset.${name} to ${target}`);
      }
      continue;
    }
    if (root === 'memorySessionOptions') {
      if (!projection.spreads.has('memorySessionOptions')) {
        findings.push(`${label}: memorySessionOptions spread is missing`);
      }
      continue;
    }
    if (!projection.edges.get(target)?.has(`${root}.${name}`)) {
      findings.push(`${label}: mapping to ${target} is missing or reads another field`);
    }
  }
}

/** Pure evaluator: tests replace one source string at a time without touching the checkout. */
export function findSessionCapabilityProjectionFindings(sources) {
  examinedRelationGroups = 0;
  const findings = [];
  const render = fields(sources, SOURCE_FILES.render, 'IRenderOptions', findings);
  const channel = fields(
    sources,
    SOURCE_FILES.tuiChannel,
    'ITuiInteractionChannelOptions',
    findings,
  );
  const headless = fields(
    sources,
    SOURCE_FILES.headless,
    'IHeadlessInteractionChannelOptions',
    findings,
  );
  const serve = fields(sources, SOURCE_FILES.serve, 'IServeModeOptions', findings);
  const preset = fields(sources, SOURCE_FILES.presetSurface, 'IPresetSurfaceOptions', findings);
  const tool = fields(sources, SOURCE_FILES.print, 'IPrintModeToolOptions', findings);
  const resolution = fields(sources, SOURCE_FILES.print, 'IPrintModeSessionResolution', findings);
  const memory = fields(sources, SOURCE_FILES.memory, 'IMemorySessionOptions', findings);
  const args = fields(sources, SOURCE_FILES.cliArgs, 'IParsedCliArgs', findings);
  const session = fields(
    sources,
    SOURCE_FILES.sessionOptions,
    'IInteractiveSessionStandardOptions',
    findings,
  );
  if (!printPresetAliasIsDerived(sources[SOURCE_FILES.print])) {
    findings.push(
      'print source presetOptions: IPrintModePresetOptions no longer derives from IPresetSurfaceOptions',
    );
  }
  if (!servePresetAliasIsDerived(sources[SOURCE_FILES.serve])) {
    findings.push(
      'serve preset→session: IServeModePresetOptions no longer derives from IPresetSurfaceOptions',
    );
  }

  const renderProjection = objectFor(
    sources[SOURCE_FILES.render],
    SOURCE_FILES.render,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'toChannelOptions',
  );
  const tuiProjection = objectFor(
    sources[SOURCE_FILES.tuiSession],
    SOURCE_FILES.tuiSession,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'buildTuiSessionOptions',
  );
  const printProjection = objectFor(
    sources[SOURCE_FILES.print],
    SOURCE_FILES.print,
    (node, ast) =>
      node.kind === ts.SyntaxKind.NewExpression &&
      node.expression.getText(ast) === 'HeadlessInteractionChannel',
  );
  const headlessProjection = objectFor(
    sources[SOURCE_FILES.headless],
    SOURCE_FILES.headless,
    (node, ast) =>
      ts.isCallExpression(node) && node.expression.getText(ast) === 'buildRuntimeSession',
  );
  const serveProjection = objectFor(
    sources[SOURCE_FILES.serve],
    SOURCE_FILES.serve,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'buildServeSessionOptions',
  );
  const presetHelperProjection = objectFor(
    sources[SOURCE_FILES.presetSessionFields],
    SOURCE_FILES.presetSessionFields,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'presetSessionFields',
  );
  const cliRenderProjection = objectFor(
    sources[SOURCE_FILES.cli],
    SOURCE_FILES.cli,
    (node, ast) => ts.isCallExpression(node) && node.expression.getText(ast) === 'renderApp',
  );
  const cliServeProjection = objectFor(
    sources[SOURCE_FILES.cli],
    SOURCE_FILES.cli,
    (node, ast) => ts.isCallExpression(node) && node.expression.getText(ast) === 'runServeMode',
  );
  const printPolicyIndex = printParameterNames(sources[SOURCE_FILES.print]).indexOf('orgPolicy');
  const cliPrintArguments = callArguments(
    sources[SOURCE_FILES.cli],
    SOURCE_FILES.cli,
    'runPrintMode',
  );
  if (printPolicyIndex < 0 || cliPrintArguments[printPolicyIndex] !== 'orgPolicy') {
    findings.push('CLI→print/goal orgPolicy: resolved policy argument is missing');
  }
  for (const [label, projection] of [
    ['CLI→serve', cliServeProjection],
    ['CLI→TUI', cliRenderProjection],
  ]) {
    if (!projection.expressions.get('orgPolicy')?.includes('orgPolicy')) {
      findings.push(`${label} orgPolicy: resolved policy value is missing`);
    }
  }
  const toSessionProjection = objectFor(
    sources[SOURCE_FILES.presetSurface],
    SOURCE_FILES.presetSurface,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'toSessionOptions',
  );

  if (!cliRenderProjection.spreads.has('toSessionOptions(presetSurface)')) {
    findings.push('preset→render toSessionOptions: CLI render spread is missing');
  }
  if (!toSessionProjection.spreads.has('rest')) {
    findings.push('preset→render toSessionOptions: same-name preset spread is missing');
  }
  const presetRenames = {
    systemPrompt: 'presetSystemPrompt',
    cliAppendSystemPrompt: 'appendSystemPrompt',
  };
  const removedFromRest = presetFieldsRemovedFromRest(sources[SOURCE_FILES.presetSurface]);
  for (const name of preset) {
    if (name === 'model' || name === 'effortResolution') continue;
    const target = presetRenames[name] ?? name;
    if (!render.includes(target)) {
      findings.push(`preset→render ${name}→${target}: destination capability is not declared`);
    }
    if (target === name && removedFromRest.has(name)) {
      findings.push(`preset→render ${name}: removed from the same-name spread`);
    }
    if (target !== name && !toSessionProjection.expressions.get(target)?.includes(name)) {
      findings.push(`preset→render ${name}→${target}: helper rename is missing`);
    }
  }

  check('render→channel', render, renderProjection, findings, {
    sourceRoot: 'options',
    destinationFields: channel,
    rename: { modelId: 'model' },
    special: {
      modelId: { exact: 'options.modelId' },
      resumeSessionId: { ref: 'resumeSessionId', exact: 'resumeSessionId' },
    },
  });
  check('channel→session', channel, tuiProjection, findings, {
    sourceRoot: 'opts',
    destinationFields: session,
  });
  check('print→headless', headless, printProjection, findings, {
    special: {
      orgPolicy: { exact: 'orgPolicy' },
      appendSystemPrompt: { spread: /^presetSessionFields\(presetOptions\)$/ },
      allowedTools: { spread: /^presetSessionFields\(presetOptions\)$/ },
      deniedTools: { spread: /^presetSessionFields\(presetOptions\)$/ },
      memoryStore: { spread: /^memorySessionOptions$/ },
      automaticMemory: { spread: /^memorySessionOptions$/ },
      recallMemory: { spread: /^memorySessionOptions$/ },
    },
  });
  const helperSources = preset.filter((name) =>
    [...presetHelperProjection.edges.values()].some((refs) => refs.has(`preset.${name}`)),
  );
  for (const [root, names, options] of [
    [
      'presetOptions',
      preset,
      {
        rename: { cliAppendSystemPrompt: 'appendSystemPrompt', systemPrompt: 'presetSystemPrompt' },
        helper: { fields: helperSources, projection: presetHelperProjection },
      },
    ],
    ['toolOptions', tool, {}],
    ['sessionResolution', resolution, {}],
    ['memorySessionOptions', memory, {}],
  ]) {
    checkPrintSource(root, names, headless, printProjection, findings, options);
  }
  // Parsed flags that are already folded into presetOptions at the CLI composition root have an
  // explicit disposition here. The remaining session-shaped flags must be read by print mode.
  const resolvedBeforePrint = new Set([
    'provider',
    'model',
    'effort',
    'outputStyle',
    'allowedTools',
    'deniedTools',
    'appendSystemPrompt',
    'language',
    'forkSession',
  ]);
  const printArgs = args.filter(
    (name) =>
      (session.includes(name) || ['bare', 'outputFormat'].includes(name)) &&
      !resolvedBeforePrint.has(name),
  );
  checkPrintSource('args', printArgs, headless, printProjection, findings);
  for (const name of printParameterNames(sources[SOURCE_FILES.print])) {
    if (
      !session.includes(name) ||
      [
        'args',
        'presetOptions',
        'toolOptions',
        'sessionResolution',
        'memorySessionOptions',
      ].includes(name)
    )
      continue;
    const expression = printProjection.expressions.get(name) ?? [];
    if (
      !headless.includes(name) ||
      !expression.some((value) => new RegExp(`\\b${name}\\b`).test(value))
    ) {
      findings.push(`print source parameter ${name}: mapping to headless is missing`);
    }
  }
  check('headless→session', headless, headlessProjection, findings, {
    sourceRoot: 'this.opts',
    destinationFields: session,
    special: {
      shellExec: { ref: 'shellExec', exact: 'shellExec' },
      permissionMode: { exact: "this.opts.permissionMode ?? 'bypassPermissions'" },
      bare: { exact: 'this.opts.bare || undefined' },
    },
  });
  check('serve→session', serve, serveProjection, findings, {
    sourceRoot: 'opts',
    destinationFields: session,
    special: {
      memorySessionOptions: { spread: /^opts\.memorySessionOptions$/ },
      sessionStore: { exact: 'args.noSessionPersistence ? undefined : opts.sessionStore' },
    },
  });
  // `preset` is an intermediate carrier, not a session option of its own. Its declared session
  // group crosses this edge through one helper call; removing that call must be visible here.
  if (!serveProjection.spreads.has('presetSessionFields(preset)')) {
    findings.push(
      'serve→session presetSessionFields: required preset capability spread is missing',
    );
  }
  for (const name of preset) {
    // The shell resolves the final model on `opts.model`; effortResolution is headless result
    // metadata, not an InteractiveSession option. Every other preset field must cross this edge.
    if (name === 'model' || name === 'effortResolution') continue;
    const target = presetRenames[name] ?? name;
    const label = `serve preset→session ${name}→${target}`;
    if (!session.includes(target)) {
      findings.push(`${label}: destination capability is not declared`);
    }
    if (helperSources.includes(name)) {
      if (!presetHelperProjection.expressions.get(target)?.includes(`preset.${name}`)) {
        findings.push(`${label}: helper mapping is missing`);
      }
    } else if (!serveProjection.edges.get(target)?.has(`preset.${name}`)) {
      findings.push(`${label}: direct mapping is missing or reads another field`);
    }
  }
  return findings;
}

export function readSessionCapabilitySources(root = resolveWorkspaceRoot(import.meta)) {
  return Object.fromEntries(
    Object.values(SOURCE_FILES).map((file) => [file, readFileSync(path.join(root, file), 'utf8')]),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const findings = findSessionCapabilityProjectionFindings(readSessionCapabilitySources());
    console.log(
      `::examined:: ${readExaminedSessionCapabilityRelationCount()} direct session capability relation groups`,
    );
    for (const finding of findings) console.error(`session-capability-projections: ${finding}`);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(
      `session-capability-projections: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
