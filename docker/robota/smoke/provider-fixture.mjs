// A loopback OpenAI-compatible chat-completions endpoint, so the image can be smoke-tested without
// a real provider or credential. With FIXTURE_COMMAND set, the first reply asks for one Bash tool
// call running that command (which the image runs inside the OS sandbox); the final reply is
// FIXTURE_TEXT followed by the command's output, so the run's result shows what the sandbox allowed.
// Usage: FIXTURE_TEXT=SMOKE_OK [FIXTURE_COMMAND='id'] node provider-fixture.mjs   (port ${PORT:-8080})
import { createServer } from 'node:http';

const text = process.env.FIXTURE_TEXT ?? 'SMOKE_OK';
const command = process.env.FIXTURE_COMMAND;
const port = Number(process.env.PORT ?? 8080);
let round = 0;

function reply(request) {
  const toolResults = request.messages.filter((message) => message.role === 'tool');
  const offersBash = (request.tools ?? []).some((tool) => tool.function?.name === 'Bash');
  if (command !== undefined && offersBash && toolResults.length === 0) {
    const call = { id: `call-${round}`, type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command }) } };
    return { message: { role: 'assistant', content: null, tool_calls: [{ index: 0, ...call }] }, finish: 'tool_calls' };
  }
  const output = toolResults.map((message) => String(message.content)).join('\n');
  return { message: { role: 'assistant', content: output ? `${text}\n${output}` : text }, finish: 'stop' };
}

createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += String(chunk);
  const body = JSON.parse(raw);
  const streaming = body.stream === true;
  round += 1;
  const { message, finish } = reply(body);
  const chunk = {
    id: `reply-${round}`,
    object: streaming ? 'chat.completion.chunk' : 'chat.completion',
    created: 1,
    model: 'fixture-model',
    choices: [{ index: 0, ...(streaming ? { delta: message } : { message }), finish_reason: finish }],
  };
  process.stdout.write(`request ${round} stream=${streaming} finish=${finish}\n`);
  if (!streaming) {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(chunk));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
}).listen(port, '0.0.0.0', () => process.stdout.write(`provider fixture listening on ${port}\n`));
