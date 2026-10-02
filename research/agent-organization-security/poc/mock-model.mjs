/** Offline loopback model surrogate. Real CLI/session/tools run; model behavior is deterministic. */
import http from 'node:http';
const port = Number(process.argv[2] ?? 18080);
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  const buffers = [];
  for await (const chunk of req) {
    buffers.push(chunk);
    if (buffers.reduce((n, b) => n + b.length, 0) > 1024 * 1024) {
      res.writeHead(413).end();
      return;
    }
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(buffers).toString());
  } catch {
    res.writeHead(400).end();
    return;
  }
  const messages = body.messages ?? [];
  const prompt = messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content))
    .join('\n');
  const hasToolResult = messages.some((m) => m.role === 'tool');
  const shellRequested = prompt.includes('RESEARCH_SHELL_');
  const results = messages.filter((m) => m.role === 'tool');
  if (prompt.includes('RESEARCH_SUBAGENT_PARENT') && hasToolResult) {
    const result = JSON.stringify(results.at(-1).content);
    process.stdout.write(
      JSON.stringify({
        event: 'agent-response',
        agentOffered: body.tools?.some((t) => t.function?.name === 'Agent') ?? false,
        unknownAgent: /unknown agent|not found/i.test(result),
        unknownTool: /unknown tool|tool not|not available/i.test(result),
        disabled: /disabled/i.test(result),
        permissionDenied: /permission|denied|approval/i.test(result),
        workerError: /worker|Sub-agent error/i.test(result),
        childMarkerPresent: /RESEARCH_HEADLESS_VM_OK/.test(result),
      }) + '\n',
    );
  }
  let toolCalls =
    shellRequested && !hasToolResult
      ? [
          {
            id: 'synthetic-shell',
            type: 'function',
            function: {
              name: 'Bash',
              arguments: JSON.stringify({
                command: 'printf shell-ok > shell-result.txt',
                timeout: 1000,
              }),
            },
          },
        ]
      : undefined;
  if (prompt.includes('RESEARCH_FILES')) {
    const runId = prompt.match(/RESEARCH_FILES_([a-f0-9]{32})/)?.[1] ?? 'missing-run-id';
    const root = `/home/researcher/workspace/file-proof-${runId}`;
    const canary = `synthetic-file-canary-${runId}`;
    const steps = [
      [
        'Write',
        {
          filePath: `${root}/file-canary.txt`,
          content: canary,
        },
      ],
      ['Read', { filePath: `${root}/file-canary.txt` }],
      [
        'Bash',
        {
          command: `cd ${root} && git init -q && git add file-canary.txt && git -c user.name=synthetic -c user.email=synthetic@example.invalid commit -qm synthetic-file-proof-${runId}`,
          timeout: 5000,
        },
      ],
    ];
    const step = steps[results.length];
    toolCalls = step
      ? [
          {
            id: `synthetic-file-${results.length}`,
            type: 'function',
            function: { name: step[0], arguments: JSON.stringify(step[1]) },
          },
        ]
      : undefined;
    if (results.length === 2)
      process.stdout.write(
        JSON.stringify({
          event: 'read-tool-response',
          runId,
          canaryPresent: JSON.stringify(results.at(-1).content).includes(canary),
        }) + '\n',
      );
  } else if (prompt.includes('RESEARCH_SUBAGENT_PARENT')) {
    const agentCommand = body.tools?.find((t) => t.function?.name.endsWith('_command_agent'))
      ?.function.name;
    toolCalls = !hasToolResult
      ? [
          {
            id: 'synthetic-child',
            type: 'function',
            function: {
              name: agentCommand ?? 'research_agent_command_agent',
              arguments: JSON.stringify({ args: 'parallel --wait child:"RESEARCH_CHILD_FILE"' }),
            },
          },
        ]
      : undefined;
  } else if (prompt.includes('RESEARCH_CHILD_FILE')) {
    toolCalls = !hasToolResult
      ? [
          {
            id: 'synthetic-child-shell',
            type: 'function',
            function: {
              name: 'Bash',
              arguments: JSON.stringify({
                command: 'printf child-ok > subagent-result.txt',
                timeout: 1000,
              }),
            },
          },
        ]
      : undefined;
  }
  const content = toolCalls
    ? null
    : shellRequested
      ? 'RESEARCH_SHELL_FINISHED'
      : prompt.includes('RESEARCH_FILES')
        ? 'RESEARCH_FILES_FINISHED'
        : prompt.includes('RESEARCH_SUBAGENT_PARENT')
          ? 'RESEARCH_SUBAGENT_FINISHED'
          : 'RESEARCH_HEADLESS_VM_OK';
  const id = 'chatcmpl-synthetic';
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = {
      role: 'assistant',
      ...(toolCalls ? { tool_calls: toolCalls.map((t, index) => ({ index, ...t })) } : { content }),
    };
    for (const [d, finish] of [
      [delta, null],
      [{}, toolCalls ? 'tool_calls' : 'stop'],
    ]) {
      res.write(
        `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: 'synthetic', choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`,
      );
    }
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id,
        object: 'chat.completion',
        created: 0,
        model: 'synthetic',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content,
              ...(toolCalls ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: toolCalls ? 'tool_calls' : 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }
});
server.listen(port, '127.0.0.1', () =>
  process.stdout.write(`synthetic model listening on loopback:${port}\n`),
);
const stop = () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
