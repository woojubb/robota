import { createServer } from 'node:http';

const products = [['cedar', 43123], ['amber', 43124]];
const servers = await Promise.all(products.map(async ([product, port]) => {
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }] }));
      return;
    }
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const content = `${product.toUpperCase()} fixture response.`;
    if (payload.stream) {
      response.setHeader('content-type', 'text/event-stream');
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      id: 'fixture', object: 'chat.completion', model: 'fixture-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }));
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', done);
  });
  process.stdout.write(`${product} provider listening at http://127.0.0.1:${port}/v1\n`);
  return server;
}));

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  for (const server of servers) server.close();
});
