// DIST-006: the runner spawns `execPath args… --__agent-subagent-worker`, so the fixture asserts
// the same entry contract the real composition root satisfies. Without this it would pass while the
// flag was never delivered.
if (!process.argv.includes('--__agent-subagent-worker')) {
  process.stderr.write('fixture worker started without the worker-mode flag\n');
  process.exit(2);
}
if (process.send === undefined) {
  process.stderr.write('fixture worker started without an IPC channel\n');
  process.exit(2);
}

process.send({ type: 'ready' });

// Issue #3256: records the settings the start payload carried and every change sent afterwards, in
// whatever order they arrive, and answers once it has the start and two changes.
const sandboxEcho = { payloadSettings: null, updates: [], started: false };
function answerSandboxEcho() {
  if (!sandboxEcho.started || sandboxEcho.updates.length < 2) return;
  process.send?.({
    type: 'result',
    output: JSON.stringify({
      payloadSettings: sandboxEcho.payloadSettings,
      updates: sandboxEcho.updates,
    }),
  });
  setTimeout(() => process.exit(0), 0);
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    process.send?.({ type: 'error', message: 'malformed' });
    return;
  }

  if (process.env.AGENT_FIXTURE_MODE === 'echo-sandbox-updates') {
    if (message.type === 'sandbox_settings') sandboxEcho.updates.push(message.settings);
    if (message.type === 'start') {
      sandboxEcho.started = true;
      sandboxEcho.payloadSettings = message.payload?.parentSandboxSettings ?? null;
    }
    answerSandboxEcho();
    return;
  }

  if (message.type === 'start') {
    const taskId = message.payload?.taskId ?? 'unknown';
    if (process.env.AGENT_FIXTURE_MODE === 'wait') {
      return;
    }
    // Issue #3288 §1: a tool call needing approval. Sends the request once, then reports whatever
    // answer arrives (or never resolves, for a test that cancels the job while it is outstanding).
    if (process.env.AGENT_FIXTURE_MODE === 'permission-request') {
      process.send?.({
        type: 'permission_request',
        requestId: 'r1',
        toolName: 'Glob',
        toolArgs: { pattern: '**/*' },
      });
      return;
    }
    if (process.env.AGENT_FIXTURE_MODE === 'permission-request-wait') {
      process.send?.({ type: 'permission_request', requestId: 'r1', toolName: 'Glob' });
      return;
    }
    // Issue #3288 §1 (review item 3): sends the request, then — without waiting for an answer —
    // immediately reports a result too, simulating the child settling while a request is still
    // outstanding on the parent side.
    if (process.env.AGENT_FIXTURE_MODE === 'permission-request-then-result') {
      process.send?.({ type: 'permission_request', requestId: 'r1', toolName: 'Glob' });
      process.send?.({ type: 'result', output: 'raced' });
      setTimeout(() => process.exit(0), 0);
      return;
    }
    if (process.env.AGENT_FIXTURE_MODE === 'progress') {
      process.send?.({ type: 'tool_start', toolName: 'Read', toolArgs: { file_path: 'file.ts' } });
      process.send?.({ type: 'text_delta', delta: 'partial ' });
      process.send?.({ type: 'tool_end', toolName: 'Read', success: true });
    }
    // SEC-009: echoes the provider profile EXACTLY as it crossed the IPC boundary, so a test can
    // assert on the wire message rather than on the function that built it. A payload assertion
    // taken parent-side would still pass if the value were re-resolved before `send`.
    if (process.env.AGENT_FIXTURE_MODE === 'echo-profile') {
      process.send?.({ type: 'result', output: JSON.stringify(message.payload?.providerProfile) });
      setTimeout(() => process.exit(0), 0);
      return;
    }
    if (process.env.AGENT_FIXTURE_MODE === 'echo-selected-environment') {
      process.send?.({ type: 'result', output: JSON.stringify({
        selected: process.env.SYNTHETIC_SELECTED_PROVIDER_KEY,
        unrelated: process.env.SYNTHETIC_UNRELATED_PARENT_SECRET,
      }) });
      setTimeout(() => process.exit(0), 0);
      return;
    }
    // ARCH-033/ARCH-034: echoes the two projected fields EXACTLY as they crossed the boundary, for
    // the same reason `echo-profile` exists — review found both declared here and read by the worker
    // while nothing ever SET them, and a parent-side assertion on the builder would not have caught
    // that the value never reached the wire.
    if (process.env.AGENT_FIXTURE_MODE === 'echo-projection') {
      process.send?.({
        type: 'result',
        output: JSON.stringify({
          sessionTiers: message.payload?.sessionTiers ?? null,
          sandboxProjection: message.payload?.sandboxProjection ?? null,
          parentSandboxSettings: message.payload?.parentSandboxSettings ?? null,
        }),
      });
      setTimeout(() => process.exit(0), 0);
      return;
    }
    // ARCH-031: reports the forked process's own OS working directory, so a test can observe where
    // the child actually landed rather than where the request said it should.
    if (process.env.AGENT_FIXTURE_MODE === 'cwd') {
      process.send?.({ type: 'result', output: process.cwd() });
      setTimeout(() => process.exit(0), 0);
      return;
    }
    if (process.env.AGENT_FIXTURE_MODE === 'usage') {
      process.send?.({
        type: 'result',
        output: `completed:${taskId}`,
        usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420 },
      });
      setTimeout(() => process.exit(0), 0);
      return;
    }
    process.send?.({ type: 'result', output: `completed:${taskId}` });
    setTimeout(() => process.exit(0), 0);
    return;
  }

  if (message.type === 'send') {
    process.send?.({ type: 'result', output: `sent:${message.prompt}` });
    setTimeout(() => process.exit(0), 0);
    return;
  }

  if (message.type === 'cancel') {
    process.send?.({ type: 'cancelled', reason: message.reason });
    setTimeout(() => process.exit(0), 0);
    return;
  }

  if (message.type === 'permission_response') {
    process.send?.({ type: 'result', output: `permission:${message.requestId}:${message.result}` });
    setTimeout(() => process.exit(0), 0);
    return;
  }

  process.send?.({ type: 'error', message: 'unknown message' });
});
