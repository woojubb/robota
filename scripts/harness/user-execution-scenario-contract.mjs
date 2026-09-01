import {
  canonicalProductStatePath,
  productSurfaceInvocation,
} from './user-execution-scenario-surface.mjs';

function atxHeading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
  if (!match) return null;
  return {
    level: match[1].length,
    content: (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim(),
  };
}

export function normalizedScenarioLines(body) {
  return body
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, '')
        .replaceAll('**', ''),
    )
    .filter(Boolean);
}

export function scenarioEntries(section) {
  const source = String(section ?? '').split('\n');
  const entries = [];
  for (let index = 0; index < source.length; index += 1) {
    const heading = atxHeading(source[index]);
    const identity =
      heading?.level === 3 ? /^Scenario ([1-9]\d*)(?::\s+.+)?$/.exec(heading.content) : null;
    if (!identity) continue;
    let end = source.length;
    for (let cursor = index + 1; cursor < source.length; cursor += 1) {
      const next = atxHeading(source[cursor]);
      if (next && next.level <= 3) {
        end = cursor;
        break;
      }
    }
    entries.push({
      number: Number(identity[1]),
      name: heading.content,
      body: source.slice(index + 1, end).join('\n'),
    });
  }
  return entries;
}

function scenarioField(fields, label) {
  const matches = fields.filter((line) => label.test(line));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(matches[0].indexOf(':') + 1).trim();
  return value || null;
}

function scenarioFieldCount(fields, label) {
  return fields.filter((line) => label.test(line)).length;
}

export function scenarioContract(body, outcome) {
  const fields = normalizedScenarioLines(body);
  const knownField =
    /^(?:executability|product surface|surface rationale|prerequisites?|command|browser steps?|ui steps?|automation barrier|unavailable capability|attempted automation|observable type|observable rationale|product state path|expected (?:observable|result)|cleanup|reset|evidence):\s*\S/i;
  if (!fields.every((line) => knownField.test(line))) return null;
  const executability = scenarioField(fields, /^executability:/i);
  const surface = scenarioField(fields, /^product surface:/i);
  const surfaceRationale = scenarioField(fields, /^surface rationale:/i);
  const command = scenarioField(fields, /^command:/i);
  const browserSteps = scenarioField(fields, /^browser steps?:/i);
  const uiSteps = scenarioField(fields, /^ui steps?:/i);
  const barrier = scenarioField(fields, /^automation barrier:/i);
  const unavailableCapability = scenarioField(fields, /^unavailable capability:/i);
  const attemptedAutomation = scenarioField(fields, /^attempted automation:/i);
  const observableType = scenarioField(fields, /^observable type:/i);
  const observableRationale = scenarioField(fields, /^observable rationale:/i);
  const productStatePath = scenarioField(fields, /^product state path:/i);
  const observable = scenarioField(fields, /^expected (?:observable|result):/i);
  const prerequisites = scenarioField(fields, /^prerequisites?:/i);
  const cleanup = scenarioField(fields, /^(?:cleanup|reset):/i);
  const evidence = scenarioField(fields, /^evidence:/i);
  const invocation = productSurfaceInvocation(surface, command, uiSteps, browserSteps);
  const allowedObservableTypes = new Map([
    ['robota-cli', new Set(['product-output', 'product-state-file'])],
    ['robota-tui', new Set(['product-output', 'ui-state', 'product-state-file'])],
    ['robota-browser-ui', new Set(['ui-state'])],
    ['public-sdk-example', new Set(['sdk-result'])],
  ]);
  const observableMatchesSurface =
    observableType !== null && allowedObservableTypes.get(surface)?.has(observableType) === true;
  const surfaceRationaleMatches =
    surfaceRationale ===
    new Map([
      ['robota-cli', 'shipped-entrypoint=robota'],
      ['robota-tui', 'shipped-entrypoint=robota'],
      ['robota-browser-ui', 'shipped-interface=robota-browser-ui'],
      ['public-sdk-example', 'shipped-interface=public-sdk-example'],
    ]).get(surface);
  const observableRationaleMatches =
    observableRationale ===
    new Map([
      ['product-output', 'source=product-process'],
      ['ui-state', 'source=rendered-product-ui'],
      ['sdk-result', 'source=public-sdk-return'],
      ['product-state-file', 'source=robota-state-artifact'],
    ]).get(observableType);
  const observableMatchesType =
    observableType === 'product-output'
      ? /^exit=(?:0|[1-9]\d*);\s*output-contains=\S.*$/.test(observable ?? '')
      : observableType === 'ui-state'
        ? /^visible=\S.*$/.test(observable ?? '')
        : observableType === 'sdk-result'
          ? /^result=\S.*$/.test(observable ?? '')
          : observableType === 'product-state-file'
            ? /^change=(?:created|updated|deleted)$/.test(observable ?? '')
            : false;
  const normalizedStatePath = canonicalProductStatePath(productStatePath);
  const statePathMatches =
    observableType === 'product-state-file'
      ? normalizedStatePath !== null
      : scenarioFieldCount(fields, /^product state path:/i) === 0;
  const allowedBarrier =
    /^(?:physical-device|credential-bound-service|platform-api-unavailable|accessibility-tree-unavailable|sandbox-restriction)$/.test(
      barrier ?? '',
    );
  const matchingExecutability =
    outcome === 'automatable'
      ? executability === 'agent-executable' &&
        (surface === 'robota-browser-ui'
          ? browserSteps !== null && scenarioFieldCount(fields, /^command:/i) === 0
          : command !== null && scenarioFieldCount(fields, /^browser steps?:/i) === 0) &&
        scenarioFieldCount(fields, /^ui steps?:/i) === 0 &&
        scenarioFieldCount(
          fields,
          /^(?:automation barrier|unavailable capability|attempted automation):/i,
        ) === 0
      : outcome === 'manual' &&
        /^manual-only:\s*\S/i.test(executability ?? '') &&
        uiSteps !== null &&
        (surface === 'robota-tui'
          ? command !== null
          : surface === 'robota-browser-ui' && scenarioFieldCount(fields, /^command:/i) === 0) &&
        scenarioFieldCount(fields, /^browser steps?:/i) === 0 &&
        allowedBarrier &&
        (unavailableCapability?.length ?? 0) >= 20 &&
        (attemptedAutomation?.length ?? 0) >= 30;
  const complete =
    matchingExecutability &&
    surface !== null &&
    surfaceRationaleMatches &&
    invocation !== null &&
    prerequisites !== null &&
    observableMatchesSurface &&
    observableMatchesType &&
    statePathMatches &&
    observable !== null &&
    observableRationaleMatches &&
    cleanup !== null &&
    evidence !== null;
  return complete
    ? {
        executability,
        surface,
        invocation,
        command,
        browserSteps,
        barrier,
        unavailableCapability,
        attemptedAutomation,
        observableType,
        observable,
        surfaceRationale,
        observableRationale,
        productStatePath: normalizedStatePath,
        uiSteps,
        prerequisites,
        cleanup,
        evidence,
      }
    : null;
}

export function validateApplicableScenarioSection(section) {
  const scenarios = scenarioEntries(section);
  if (scenarios.length === 0)
    return { ok: false, error: 'applicable scenario section has no Scenario entries' };
  const invalid = scenarios.find(
    (scenario, index) =>
      scenario.number !== index + 1 ||
      (scenarioContract(scenario.body, 'automatable') === null &&
        scenarioContract(scenario.body, 'manual') === null),
  );
  return invalid
    ? { ok: false, error: `applicable ${invalid.name} is incomplete or non-canonical` }
    : { ok: true, scenarios };
}
