// DIST-006: the runner spawns `execPath args… --__robota-subagent-worker`, so the fixture asserts
// the same entry contract the real composition root satisfies. Without this it would pass while the
// flag was never delivered.
if (!process.argv.includes('--__robota-subagent-worker')) {
  process.stderr.write('fixture worker started without the worker-mode flag\n');
  process.exit(2);
}
if (process.send === undefined) {
  process.stderr.write('fixture worker started without an IPC channel\n');
  process.exit(2);
}

process.send({ type: 'ready' });

process.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    process.send?.({ type: 'error', message: 'malformed' });
    return;
  }

  if (message.type === 'start') {
    const taskId = message.payload?.taskId ?? 'unknown';
    if (process.env.ROBOTA_FIXTURE_MODE === 'wait') {
      return;
    }
    if (process.env.ROBOTA_FIXTURE_MODE === 'progress') {
      process.send?.({ type: 'tool_start', toolName: 'Read', toolArgs: { file_path: 'file.ts' } });
      process.send?.({ type: 'text_delta', delta: 'partial ' });
      process.send?.({ type: 'tool_end', toolName: 'Read', success: true });
    }
    // SEC-009: echoes the provider profile EXACTLY as it crossed the IPC boundary, so a test can
    // assert on the wire message rather than on the function that built it. A payload assertion
    // taken parent-side would still pass if the value were re-resolved before `send`.
    if (process.env.ROBOTA_FIXTURE_MODE === 'echo-profile') {
      process.send?.({ type: 'result', output: JSON.stringify(message.payload?.providerProfile) });
      setTimeout(() => process.exit(0), 0);
      return;
    }
    // ARCH-031: reports the forked process's own OS working directory, so a test can observe where
    // the child actually landed rather than where the request said it should.
    if (process.env.ROBOTA_FIXTURE_MODE === 'cwd') {
      process.send?.({ type: 'result', output: process.cwd() });
      setTimeout(() => process.exit(0), 0);
      return;
    }
    if (process.env.ROBOTA_FIXTURE_MODE === 'usage') {
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

  process.send?.({ type: 'error', message: 'unknown message' });
});
