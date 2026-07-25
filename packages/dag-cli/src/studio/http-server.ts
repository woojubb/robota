import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { IDagDefinition, TRunProgressEvent } from '@robota-sdk/dag-core';
import { isWorkflowFileFormat, fromDagWorkflowFile } from '@robota-sdk/dag-builder';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import {
  LocalDagRunner,
  createCliNodeRegistry,
  loadLocalNodeDefinitions,
} from '../local-runner/index.js';
import { extractFinalOutput } from '../commands/run.js';
import { jsonReply, readBody, sendSSE } from './http-io.js';
import {
  routeProvidersConnect,
  routeProvidersList,
  routeProvidersNodes,
} from './provider-routes.js';
import { isLoopbackHostHeader, resolveContainedFile } from './request-guards.js';
import { buildStudioHtml } from './ui-html.js';

interface IValidationError {
  code: string;
  message: string;
  nodeId?: string;
}

const HTML_CT = 'text/html; charset=utf-8';

export interface IStudioServerOptions {
  cwd: string;
}

async function parseDagFile(
  filePath: string,
): Promise<{ ok: true; value: IDagDefinition } | { ok: false; message: string }> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (e) {
    // allow-fallback: file-not-found is a user error; returning structured error to caller
    return {
      ok: false,
      message: `Cannot read file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (e) {
    // allow-fallback: JSON parse failure is a user error; returning structured error to caller
    return { ok: false, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: 'DAG file must be a JSON object.' };
  }
  if (isWorkflowFileFormat(parsed))
    return { ok: true, value: fromDagWorkflowFile(parsed, undefined) };
  return { ok: true, value: parsed as IDagDefinition };
}

async function routeDag(req: IncomingMessage, res: ServerResponse, cwd: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const fileParam = url.searchParams.get('file');
  if (!fileParam) {
    jsonReply(res, 400, { error: 'Missing ?file= parameter' });
    return;
  }
  const contained = resolveContainedFile(fileParam, cwd);
  if (!contained.ok) {
    jsonReply(res, 400, { error: contained.message });
    return;
  }
  const result = await parseDagFile(contained.path);
  if (!result.ok) {
    jsonReply(res, 400, { error: result.message });
    return;
  }
  const dag = result.value;
  const usedTypes = new Set(dag.nodes.map((n: { nodeType: string }) => n.nodeType));
  const assembly = buildNodeDefinitionAssembly(createCliNodeRegistry());
  const filteredManifests = assembly.ok
    ? assembly.value.manifests
        .filter((m) => usedTypes.has(m.nodeType))
        .map((m) => ({
          nodeType: m.nodeType,
          inputs: m.inputs.map((p) => ({ key: p.key, type: p.type })),
          outputs: m.outputs.map((p) => ({ key: p.key, type: p.type })),
        }))
    : [];
  jsonReply(res, 200, {
    dagId: dag.dagId,
    nodes: dag.nodes.map((n) => ({
      nodeId: n.nodeId,
      nodeType: n.nodeType,
      position: n.position,
      dependsOn: n.dependsOn,
      config: n.config,
    })),
    edges: dag.edges.map((e) => ({ from: e.from, to: e.to, bindings: e.bindings })),
    _manifests: filteredManifests,
  });
}

async function routeNodes(res: ServerResponse): Promise<void> {
  const assembly = buildNodeDefinitionAssembly(createCliNodeRegistry());
  if (!assembly.ok) {
    jsonReply(res, 500, { error: assembly.error.message });
    return;
  }
  jsonReply(res, 200, {
    nodes: assembly.value.manifests.map((m) => ({
      nodeType: m.nodeType,
      displayName: m.displayName,
      category: m.category,
    })),
  });
}

async function routeRun(req: IncomingMessage, res: ServerResponse, cwd: string): Promise<void> {
  // SEC-006: no `Access-Control-Allow-Origin` — the studio UI streams this from the same origin.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  // Disable Nagle's algorithm so each SSE event is sent as its own TCP packet.
  res.socket?.setNoDelay(true);

  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch {
    // allow-fallback: body read error sends SSE error event and closes the stream
    sendSSE(res, { type: 'error', message: 'Failed to read request body.' });
    res.end();
    return;
  }

  let parsed: { file?: string; inputs?: Record<string, string> };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    // allow-fallback: invalid JSON from client sends SSE error event and closes the stream
    sendSSE(res, { type: 'error', message: 'Invalid JSON body.' });
    res.end();
    return;
  }

  const { file, inputs = {} } = parsed;
  if (!file) {
    sendSSE(res, { type: 'error', message: 'Missing "file" field.' });
    res.end();
    return;
  }

  const contained = resolveContainedFile(file, cwd);
  if (!contained.ok) {
    sendSSE(res, { type: 'error', message: contained.message });
    res.end();
    return;
  }

  const dagResult = await parseDagFile(contained.path);
  if (!dagResult.ok) {
    sendSSE(res, { type: 'error', message: dagResult.message });
    res.end();
    return;
  }
  const dagDefinition = dagResult.value;

  const localNodes = await loadLocalNodeDefinitions({ projectDir: dirname(contained.path) });
  const builtIn = createCliNodeRegistry();
  const localTypes = new Set(localNodes.map((n) => n.nodeType));
  const nodeDefinitions = [...builtIn.filter((n) => !localTypes.has(n.nodeType)), ...localNodes];

  let runner: LocalDagRunner;
  try {
    runner = new LocalDagRunner(nodeDefinitions);
  } catch (e) {
    // allow-fallback: node registry construction failure is returned as SSE error
    sendSSE(res, {
      type: 'error',
      message: `Node registry error: ${e instanceof Error ? e.message : String(e)}`,
    });
    res.end();
    return;
  }

  const startTimes = new Map<string, number>();
  const startMs = Date.now();

  const unsubscribe = runner.events.subscribe((event: TRunProgressEvent) => {
    if (event.eventType === 'task.started') {
      startTimes.set(event.nodeId, Date.now());
      sendSSE(res, { type: 'task.started', nodeId: event.nodeId });
    } else if (event.eventType === 'task.completed') {
      sendSSE(res, {
        type: 'task.completed',
        nodeId: event.nodeId,
        durationMs: Date.now() - (startTimes.get(event.nodeId) ?? startMs),
      });
    } else if (event.eventType === 'task.failed') {
      sendSSE(res, {
        type: 'task.failed',
        nodeId: event.nodeId,
        durationMs: Date.now() - (startTimes.get(event.nodeId) ?? startMs),
        errorMessage: event.error.message ?? event.error.code,
      });
    }
  });

  try {
    const result = await runner.run(dagDefinition, inputs);
    unsubscribe();
    sendSSE(res, {
      type: 'final',
      output: extractFinalOutput(result.taskRuns, dagDefinition.nodes),
      durationMs: Date.now() - startMs,
    });
  } catch (e) {
    // allow-fallback: run execution error is sent as SSE error event; stream is closed cleanly
    unsubscribe();
    sendSSE(res, { type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}

async function routeValidate(
  req: IncomingMessage,
  res: ServerResponse,
  cwd: string,
): Promise<void> {
  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch {
    // allow-fallback: body read error is returned as structured validation error response
    jsonReply(res, 400, {
      ok: false,
      errors: [{ code: 'READ_ERROR', message: 'Failed to read request body.' }],
      warnings: [],
    });
    return;
  }

  let parsed: { file?: string };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    // allow-fallback: invalid JSON from client is returned as structured validation error response
    jsonReply(res, 400, {
      ok: false,
      errors: [{ code: 'PARSE_ERROR', message: 'Invalid JSON body.' }],
      warnings: [],
    });
    return;
  }

  const { file } = parsed;
  if (!file) {
    jsonReply(res, 400, {
      ok: false,
      errors: [{ code: 'MISSING_FILE', message: 'Missing "file" field.' }],
      warnings: [],
    });
    return;
  }

  const contained = resolveContainedFile(file, cwd);
  if (!contained.ok) {
    jsonReply(res, 400, {
      ok: false,
      errors: [{ code: 'PATH_NOT_ALLOWED', message: contained.message }],
      warnings: [],
    });
    return;
  }

  const dagResult = await parseDagFile(contained.path);
  if (!dagResult.ok) {
    jsonReply(res, 200, {
      ok: false,
      errors: [{ code: 'DAG_READ_ERROR', message: dagResult.message }],
      warnings: [],
    });
    return;
  }

  const dag = dagResult.value;
  const localNodes = await loadLocalNodeDefinitions({ projectDir: dirname(contained.path) });
  const builtIn = createCliNodeRegistry();
  const localTypes = new Set(localNodes.map((n) => n.nodeType));
  const nodeDefinitions = [...builtIn.filter((n) => !localTypes.has(n.nodeType)), ...localNodes];
  const assembly = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assembly.ok) {
    jsonReply(res, 200, {
      ok: false,
      errors: [{ code: 'REGISTRY_ERROR', message: assembly.error.message }],
      warnings: [],
    });
    return;
  }

  const { manifests } = assembly.value;
  const errors: IValidationError[] = [];

  // Build manifest map for fast lookup
  const manifestMap = new Map(manifests.map((m) => [m.nodeType, m]));
  const knownTypes = new Set(manifests.map((m) => m.nodeType));
  const nodes = dag.nodes ?? [];
  const edges = dag.edges ?? [];

  // Check unknown node types
  for (const node of nodes) {
    if (!knownTypes.has(node.nodeType)) {
      errors.push({
        code: 'UNKNOWN_NODE_TYPE',
        message: `Unknown node type "${node.nodeType}" at node "${node.nodeId}"`,
        nodeId: node.nodeId,
      });
    }
  }

  // Check port type compatibility on edges
  for (const edge of edges) {
    const sourceNode = nodes.find((n) => n.nodeId === edge.from);
    const targetNode = nodes.find((n) => n.nodeId === edge.to);
    if (!sourceNode || !targetNode) continue;
    const sourceManifest = manifestMap.get(sourceNode.nodeType);
    const targetManifest = manifestMap.get(targetNode.nodeType);
    if (!sourceManifest || !targetManifest) continue;
    for (const binding of edge.bindings ?? []) {
      const sourcePort = sourceManifest.outputs.find((p) => p.key === binding.outputKey);
      const targetPort = targetManifest.inputs.find((p) => p.key === binding.inputKey);
      if (sourcePort && targetPort && sourcePort.type !== targetPort.type) {
        errors.push({
          code: 'DAG_VALIDATION_PORT_TYPE_MISMATCH',
          message: `Edge "${edge.from}" → "${edge.to}" binding "${binding.outputKey}"→"${binding.inputKey}": output type "${sourcePort.type}" is incompatible with input type "${targetPort.type}"`,
          nodeId: edge.from,
        });
      }
    }
  }

  jsonReply(res, 200, { ok: errors.length === 0, errors, warnings: [] });
}

const MAX_PORT_ATTEMPTS = 10;

function buildRequestHandler(cwd: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    // SEC-006: reject a non-loopback Host so a DNS-rebinding page cannot reach this API even though the
    // server binds 127.0.0.1 only. Mirrors the monitor-UI serve host's check.
    if (!isLoopbackHostHeader(req.headers.host)) {
      jsonReply(res, 403, { error: 'Forbidden host' });
      return;
    }

    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (req.method === 'OPTIONS') {
      // SEC-006: no CORS grant is issued. The studio UI is same-origin, so cross-origin callers get a
      // 204 with no `Access-Control-*` headers and the browser blocks their request.
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/') {
      const html = buildStudioHtml();
      res.writeHead(200, { 'Content-Type': HTML_CT, 'Content-Length': Buffer.byteLength(html) });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/dag') {
      routeDag(req, res, cwd).catch(() => {
        if (!res.headersSent) jsonReply(res, 500, { error: 'Internal server error' });
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/nodes') {
      routeNodes(res).catch(() => {
        if (!res.headersSent) jsonReply(res, 500, { error: 'Internal server error' });
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/run') {
      routeRun(req, res, cwd).catch(() => {
        if (!res.headersSent) jsonReply(res, 500, { error: 'Internal server error' });
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/validate') {
      routeValidate(req, res, cwd).catch(() => {
        if (!res.headersSent) jsonReply(res, 500, { error: 'Internal server error' });
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/providers') {
      routeProvidersList(res).catch(() => {
        if (!res.headersSent) jsonReply(res, 500, { error: 'Internal server error' });
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/providers/connect') {
      routeProvidersConnect(req, res).catch(() => {
        if (!res.headersSent) jsonReply(res, 500, { error: 'Internal server error' });
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/providers/nodes') {
      routeProvidersNodes(res).catch(() => {
        if (!res.headersSent) jsonReply(res, 500, { error: 'Internal server error' });
      });
      return;
    }

    jsonReply(res, 404, { error: 'Not found' });
  };
}

function tryListenOnPort(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  port: number,
  remaining: number,
): Promise<{ port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(port, '127.0.0.1', () => {
      resolve({ port, server });
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      server.close();
      if (err.code === 'EADDRINUSE' && remaining > 0) {
        resolve(tryListenOnPort(handler, port + 1, remaining - 1));
      } else {
        reject(err);
      }
    });
  });
}

export function startStudioServer(
  preferredPort: number,
  options: IStudioServerOptions,
): Promise<{ port: number; server: Server }> {
  const handler = buildRequestHandler(options.cwd);
  return tryListenOnPort(handler, preferredPort, MAX_PORT_ATTEMPTS - 1);
}
