import assert from 'node:assert/strict';

/** Report existing product telemetry without treating retained samples as a complete trace. */
export function summarizeRuntimeTiming({
  diagnostics, steps, mcpServiceIntervals, permissionVisibleWaitMs, cancellationCase, mode,
}) {
  const records = diagnostics.split('\n').filter((line) => line.startsWith('{')).map((line) => {
    try { return JSON.parse(line); } catch { return undefined; }
  }).filter((record) => record?.signal === 'traces' || record?.signal === 'logs');
  const traces = records.filter((record) => record.signal === 'traces');
  const logs = records.filter((record) => record.signal === 'logs');
  assert.equal(traces.length, 1, 'The initial GUI turn exports exactly one product trace');
  assert.equal(logs.length, 1, 'The initial GUI turn exports exactly one product log batch');
  const spans = traces[0].spans;
  const root = spans.find((span) => span.name === 'agent.prompt_execution');
  assert.equal(root.outcome, cancellationCase ? 'interrupted' : 'success');
  const providers = spans.filter((span) => span.name === 'agent.provider_call');
  const bodies = spans.filter((span) => span.name === 'agent.tool_body');
  const decisions = logs[0].events.filter((event) => event.name === 'agent.tool_permission.decided');
  const duration = (span) => {
    const value = Date.parse(span.endedAt) - Date.parse(span.startedAt);
    assert.ok(Number.isFinite(value) && value >= 0, 'A product span has a valid measured interval');
    return value;
  };
  for (const body of bodies) assert.ok(steps.some((step) => step.id === body.toolCallId));
  const expectedBodies = mode === 'deny' || mode === 'cancel-permission' ? 0 : steps.length;
  const expectedProviders = cancellationCase ? 1 : steps.length + 1;
  assert.equal(providers.length + root.omittedProviderCount, expectedProviders);
  assert.equal(bodies.length + root.omittedToolCount, expectedBodies);
  assert.equal(decisions.length + root.omittedPermissionCount, steps.length);
  const totals = root.timingTotals;
  assert.equal(totals.provider.samples, expectedProviders);
  assert.equal(totals.tool.samples, expectedBodies);
  assert.equal(totals.queue.samples, steps.length);
  assert.equal(totals.provider.invalid + totals.tool.invalid + totals.queue.invalid, 0);
  assert.equal(totals.queue.admissionStarted + totals.queue.notDispatched, steps.length);
  const mcpBodies = bodies.filter((body) => mcpServiceIntervals.some((call) => call.id === body.toolCallId));
  const serviceMs = mcpBodies.reduce((total, body) => {
    const call = mcpServiceIntervals.find((interval) => interval.id === body.toolCallId);
    assert.ok(call.startedAt >= Date.parse(body.startedAt) && call.endedAt <= Date.parse(body.endedAt),
      'Fixture service work is contained in the observed product MCP body');
    return total + call.endedAt - call.startedAt;
  }, 0);
  const roundTripMs = mcpBodies.reduce((total, body) => total + duration(body), 0);
  return {
    scope: 'Initial GUI turn only; duration sums may overlap and must not be added as wall time. Millisecond clock resolution.',
    model: { observedMs: totals.provider.durationMs,
      samples: totals.provider.samples, invalid: totals.provider.invalid,
      retainedDetails: providers.length, omittedDetails: root.omittedProviderCount,
      scope: 'Native SDK or replay invocation, including loopback transport; no live vendor computation.' },
    queue: { ...totals.queue,
      scope: 'Batch submission until selection for pre-dispatch admission or refusal; excludes journal admission, permission and body execution. Admission-started does not attest an effect.' },
    permission: { visibleWaitMs: permissionVisibleWaitMs, decisions: decisions.length,
      omitted: root.omittedPermissionCount,
      scope: 'Fixture-observed pending GUI dialog to Allow, Deny or Stop; excludes unseen permission processing.' },
    transport: { observedRoundTripMs: roundTripMs, fixtureServiceMs: serviceMs,
      residualMs: roundTripMs - serviceMs, samples: mcpBodies.length,
      missingAcknowledgements: mode === 'cancel' ? 1 : 0,
      scope: 'Acknowledged MCP body minus contained fixture service work; residual includes client processing, not pure network time.' },
    tool: { observedMs: totals.tool.durationMs,
      samples: totals.tool.samples, invalid: totals.tool.invalid,
      retainedDetails: bodies.length, omittedDetails: root.omittedToolCount,
      scope: 'Canonical awaited tool body after permission and admission, before result truncation.' },
  };
}
