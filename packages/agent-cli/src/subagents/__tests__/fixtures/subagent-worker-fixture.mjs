process.send?.({ type: 'ready' });

process.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    process.send?.({ type: 'error', message: 'malformed' });
    return;
  }

  if (message.type === 'start') {
    const jobId = message.payload?.jobId ?? 'unknown';
    if (process.env.ROBOTA_FIXTURE_MODE === 'wait') {
      return;
    }
    process.send?.({ type: 'result', output: `completed:${jobId}` });
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
