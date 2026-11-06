/**
 * The `fetch` a scenario's bundle sees. It is written against web-standard globals only (`Request`,
 * `Response`, `Headers`, `ReadableStream`, `TextEncoder`), so the same module runs in the web-only
 * realm of `browser-runtime-proof.mjs` and in a real browser page.
 *
 * It answers from routes a scenario declares and records every request it receives, so a scenario
 * asserts the URL, headers and body a library really sent. A request no route answers fails with
 * the request named, never with an improvised response.
 */

/** A JSON reply. */
export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

/** A server-sent-events reply: each event is `{ event?, data }`, `data` serialised as JSON. */
export function sseResponse(events, init = {}) {
  const encoder = new TextEncoder();
  const text = events
    .map(
      ({ event, data }) =>
        `${event === undefined ? '' : `event: ${event}\n`}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
    )
    .join('');
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    { status: 200, ...init, headers: { 'content-type': 'text/event-stream', ...init.headers } },
  );
}

/**
 * Creates the stub. `routes` are tried in the order they were added; a route matches a request when
 * its `match` is a substring of the URL, a RegExp that matches it, or a function that returns true.
 * Its `reply` is a `Response`, or a function from the recorded request to one.
 */
export function createFetchStub() {
  const requests = [];
  const routes = [];

  async function stubFetch(input, init) {
    const request = new Request(input, init);
    const record = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.body === null ? '' : await request.clone().text(),
    };
    requests.push(record);
    const route = routes.find(({ match }) =>
      typeof match === 'function'
        ? match(record)
        : match instanceof RegExp
          ? match.test(record.url)
          : record.url.includes(match),
    );
    if (route === undefined)
      throw new Error(`fetch stub: no route answers ${record.method} ${record.url}`);
    return typeof route.reply === 'function' ? route.reply(record) : route.reply.clone();
  }

  return {
    fetch: stubFetch,
    /** Every request received so far, in order. */
    requests,
    /** Answers requests that match; returns the stub so routes chain. */
    on(match, reply) {
      routes.push({ match, reply });
      return this;
    },
  };
}
