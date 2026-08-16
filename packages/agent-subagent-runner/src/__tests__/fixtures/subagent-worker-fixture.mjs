process.send?.({ type: 'ready' });

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
