# HTTP Request Node

`@robota-sdk/dag-node-http-request` (internal) exports `HttpRequestNodeDefinition`, node type
`http-request` (category `Network`). It sends an HTTP or HTTPS request with the platform `fetch` and
emits the response.

- **Inputs** `url` (string, optional) — overrides `config.url`; `body` (string, optional) —
  overrides `config.body`; `headers` (object, optional) — merged over `config.headers`.
- **Outputs** `statusCode` (number); `body` (string); `ok` (boolean); `headers` (object).
- **Config** `method` (`GET` | `POST` | `PUT` | `PATCH` | `DELETE`, default `GET`); `url` (string,
  default `''`); `headers` (string record, default `{}`); `body` (string, optional); `timeoutMs`
  (positive integer, default `10000`).

The node calls whatever URL it is given; there is no fixed service and no environment variable. A
request with no URL fails validation. The timeout covers both headers and body, and the response
body is read under a byte ceiling that the host can tighten. Timeouts and network errors come back as
structured failures. The cost estimate is 0.

Not part of the default node set: a host registers it itself. Contract: [SPEC.md](SPEC.md).
