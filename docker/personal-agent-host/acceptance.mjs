#!/usr/bin/env node
// Acceptance run for the personal-agent host on a real container engine.
//
//   node docker/personal-agent-host/acceptance.mjs [--keep]
//
// It installs this bundle with install.sh in local-CA mode (ports 18080/18443, a state directory of
// its own, a base domain that does not exist), adds accounts with fake model keys, and runs every
// probe from inside the engine's network context: from a unit, from the proxy's host network, from
// an unguarded container. It prints one PASS, FAIL or SKIP line per check and exits non-zero on any
// FAIL. Everything it made is removed afterwards, also when a check fails or the run is interrupted:
// containers, volumes, networks, the firewall table, the state directory, the installer's settings
// file. Images stay (they are the slow part); `--keep` leaves the whole install up to look at.
//
// Every negative check is paired with a control that proves the probe could have succeeded: a
// connection the guard blocks is tried first from a container the guard does not cover, and a
// handshake that must fail is tried first for a name that must succeed.
//
// Why a Node script: the probes need TLS with a pinned CA, a WebSocket upgrade, JSON and cgroup files.
// The units, the control plane and the proxy host all ship Node 22, so the same file runs on the
// workstation as the orchestrator and, piped on stdin, inside containers as the probe program. It
// uses Node's built-ins only and installs nothing.
//
// Needs: a Linux container engine (Docker, API 1.41 or newer, cgroup v2, nf_tables), outbound
// internet for one DNS lookup and one HTTPS fetch, and free ports 18080 and 18443 on the engine host
// (ACCEPTANCE_HTTP_PORT and ACCEPTANCE_HTTPS_PORT change them). It uses no real model key or
// credential: each account gets a random fake key, and the model is a local fixture.
//
// The model fixture is on a Docker network of its own with a public-looking address (203.0.113.9,
// documentation range) and `gateway_mode_ipv4=nat-unprotected`, which makes the engine accept
// forwarded connections to it as it would for a host on another routed network. The units reach it
// through the path the guard allows for any public address; nothing in the guard, the control plane
// or the engine's firewall is loosened for it, and this script adds no firewall rule.
//
// What it changes on the engine host besides the install itself, all undone at the end: a Docker
// network and a container for the fixture, a plain network for the unguarded controls, two listener
// containers, and the metadata address (169.254.169.254/32) on the loopback device, so that a
// listener can answer it and the control can reach it.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------------------------
// Pure helpers. Exported for the unit tests; they run in both roles.
// ---------------------------------------------------------------------------------------------

/** How a connection attempt ended, as one of: connected, refused (reached, nothing listening), blocked, error. */
export function classifyConnectError(code) {
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'refused';
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'blocked';
  return 'error';
}

/** Whether a packet got to something: it connected, or something answered with a refusal. */
export function reached(outcome) {
  return outcome === 'connected' || outcome === 'refused';
}

/**
 * A copy of an archive with one byte inside the first occurrence of `needle` changed: the tar stays
 * well-formed and only the content no longer matches the hash the manifest holds.
 */
export function tamperArchive(archive, needle) {
  const at = archive.indexOf(needle);
  if (at < 0) throw new Error('the archive does not contain the text to change');
  const copy = Buffer.from(archive);
  copy[at + needle.length - 1] ^= 0x01;
  return copy;
}

function hexToIp(hex) {
  const bytes = hex.match(/../gu) ?? [];
  return bytes
    .map((byte) => parseInt(byte, 16))
    .reverse()
    .join('.');
}

/** The next hops of every default route in the text of /proc/net/route. */
export function defaultGateways(routeText) {
  const gateways = [];
  for (const line of routeText.split('\n').slice(1)) {
    const [iface, destination, gateway, flags] = line.trim().split(/\s+/u);
    if (iface === undefined || destination !== '00000000') continue;
    if ((parseInt(flags, 16) & 0x2) === 0) continue;
    gateways.push(hexToIp(gateway));
  }
  return [...new Set(gateways)];
}

/**
 * Splits a negative check's probe results into what the control proved reachable (the only targets
 * that count as evidence), what leaked through the guard, and what was inconclusive.
 */
export function judgeBlocked(targets, controlResults, probeResultsOfControlled) {
  const controlled = targets.filter((_, index) => reached(controlResults[index]?.outcome));
  const leaked = [];
  const inconclusive = [];
  controlled.forEach((target, index) => {
    const outcome = probeResultsOfControlled[index]?.outcome;
    if (reached(outcome)) leaked.push(target);
    else if (outcome !== 'blocked') inconclusive.push(target);
  });
  return { controlled, leaked, inconclusive };
}

/** Which named secrets appear in which named texts. Never returns a secret itself. */
export function findSecrets(texts, secrets) {
  const found = [];
  for (const [where, text] of Object.entries(texts)) {
    for (const [name, secret] of Object.entries(secrets)) {
      if (secret !== '' && text.includes(secret)) found.push(`${where} holds the key of ${name}`);
    }
  }
  return found;
}

export function sha8(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

/** One client-to-server WebSocket frame, masked as the protocol requires. */
export function encodeClientFrame(opcode, payload, maskKey = randomBytes(4)) {
  const data = Buffer.from(payload);
  let header;
  if (data.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
  else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= maskKey[i % 4];
  return Buffer.concat([header, maskKey, masked]);
}

/** Whole frames at the start of the buffer (masked or not), and the bytes left over. */
export function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 2) break;
    const first = buffer[offset];
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const masked = (second & 0x80) !== 0;
    const maskKey = masked ? buffer.subarray(cursor, cursor + 4) : undefined;
    if (masked) cursor += 4;
    if (buffer.length - cursor < length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (maskKey) for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4];
    frames.push({ fin: (first & 0x80) !== 0, opcode: first & 0x0f, payload });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

// ---------------------------------------------------------------------------------------------
// The probe program: what runs inside a container (a unit, the proxy host network, an unguarded
// bridge). Each probe prints one JSON line.
// ---------------------------------------------------------------------------------------------

function connectOnce({ host, port }, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (outcome, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ host, port, outcome, detail });
    };
    const timer = setTimeout(() => finish('blocked', 'timeout'), timeoutMs);
    socket.once('connect', () => finish('connected'));
    socket.once('error', (error) => finish(classifyConnectError(error.code), error.code));
  });
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    return `unreadable: ${error.code}`;
  }
}

function listen(ports, onConnection) {
  return Promise.all(
    ports.map(
      (port) =>
        new Promise((resolve, reject) => {
          const server = net.createServer((socket) => {
            onConnection?.(port);
            // A probe that connects and hangs up resets the connection; that must not stop the listener.
            socket.on('error', () => undefined);
            socket.end('listener\n');
          });
          server.once('error', reject);
          server.listen(port, '0.0.0.0', resolve);
        }),
    ),
  );
}

function serveForever() {
  process.once('SIGTERM', () => process.exit(0));
  process.once('SIGINT', () => process.exit(0));
  return new Promise(() => undefined);
}

function tlsHandshake({ port, servername, ca, host = '127.0.0.1' }) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port,
      ...(servername === undefined ? {} : { servername }),
      ca: ca === undefined ? undefined : [ca],
      rejectUnauthorized: false,
      timeout: 8000,
    });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      resolve({
        handshake: 'ok',
        authorized: socket.authorized,
        authError: socket.authorizationError ? String(socket.authorizationError) : null,
        altNames: cert.subjectaltname ?? '',
        issuer: cert.issuer?.CN ?? '',
      });
      socket.destroy();
    });
    socket.once('timeout', () => {
      resolve({ handshake: 'unreachable', code: 'timeout' });
      socket.destroy();
    });
    socket.once('error', (error) => {
      const code = String(error.code ?? error.message);
      const unreachable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(
        code,
      );
      resolve({ handshake: unreachable ? 'unreachable' : 'failed', code });
    });
  });
}

function httpRequest(args) {
  const { useTls = true, port, host = '127.0.0.1', servername, hostHeader, ca } = args;
  const { method = 'GET', requestPath = '/', headers = {}, body } = args;
  return new Promise((resolve) => {
    const options = {
      host,
      port,
      method,
      path: requestPath,
      headers: { ...(hostHeader === undefined ? {} : { host: hostHeader }), ...headers },
      timeout: 15000,
      ...(useTls ? { servername, ca: ca === undefined ? undefined : [ca] } : {}),
    };
    const request = (useTls ? https : http).request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8').slice(0, 20000),
        }),
      );
    });
    request.once('timeout', () => request.destroy(new Error('timeout')));
    request.once('error', (error) => resolve({ error: String(error.code ?? error.message) }));
    request.end(body);
  });
}

/** Upgrades a connection to the proxy to a WebSocket; resolves with the socket, or with the refusal. */
function upgradeWebSocket({ port, servername, hostHeader, wsPath, origin, ca }) {
  return new Promise((resolve) => {
    const key = randomBytes(16).toString('base64');
    const request = https.request({
      host: '127.0.0.1',
      port,
      servername,
      ca: [ca],
      path: wsPath,
      headers: {
        host: hostHeader,
        ...(origin === undefined ? {} : { origin }),
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': key,
      },
    });
    request.once('response', (response) => {
      resolve({ status: response.statusCode });
      response.resume();
    });
    request.once('error', (error) => resolve({ error: String(error.code ?? error.message) }));
    request.once('upgrade', (response, socket, head) => {
      const expected = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      resolve({
        status: response.statusCode,
        acceptOk: response.headers['sec-websocket-accept'] === expected,
        socket,
        head,
      });
    });
    request.end();
  });
}

/** Calls onMessage with each JSON text frame and onClose once when the connection ends. */
function readFrames(socket, head, onMessage, onClose) {
  let rest = Buffer.from(head);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onClose();
  };
  const take = (data) => {
    rest = Buffer.concat([rest, data]);
    const decoded = decodeFrames(rest);
    rest = decoded.rest;
    for (const frame of decoded.frames) {
      if (frame.opcode === 9) socket.write(encodeClientFrame(10, frame.payload));
      if (frame.opcode === 8) return close();
      if (frame.opcode !== 1) continue;
      try {
        onMessage(JSON.parse(frame.payload.toString('utf8')));
      } catch {
        // not a JSON frame: not one of the protocol's messages
      }
    }
    return undefined;
  };
  socket.on('data', take);
  socket.once('close', close);
  socket.once('error', close);
  if (rest.length > 0) take(Buffer.alloc(0));
}

/** A WebSocket client over the proxy: upgrade, optionally one prompt, then the frames that came back. */
async function webSocketSession(args) {
  const { prompt, timeoutMs = 90000 } = args;
  const upgraded = await upgradeWebSocket(args);
  if (upgraded.status !== 101) return upgraded;
  const { socket, head, status, acceptOk } = upgraded;
  return new Promise((resolve) => {
    const types = [];
    const finish = (extra) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ status, acceptOk, frames: types, ...extra });
    };
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    readFrames(
      socket,
      head,
      (message) => {
        types.push(String(message.type));
        if (message.type === 'complete') finish({ complete: message });
        if (message.type === 'error' || message.type === 'protocol_error') {
          finish({ failure: message });
        }
      },
      () => finish({ closed: true }),
    );
    if (prompt === undefined) setTimeout(() => finish({ idle: true }), 1500);
    else socket.write(encodeClientFrame(1, JSON.stringify({ type: 'submit', prompt })));
  });
}

/**
 * Holds a WebSocket open until told to stop (SIGTERM), then asks it a question: it must still
 * answer. It says it is ready once the upgrade is done.
 */
async function holdWebSocket(args) {
  const upgraded = await upgradeWebSocket(args);
  if (upgraded.status !== 101) return upgraded;
  const { socket, head } = upgraded;
  let received = 0;
  let closed = false;
  readFrames(
    socket,
    head,
    () => {
      received += 1;
    },
    () => {
      closed = true;
    },
  );
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
  await new Promise((resolve) => process.once('SIGTERM', resolve));
  if (closed) return { held: false, closed: true };
  const before = received;
  socket.write(encodeClientFrame(1, JSON.stringify({ type: 'get-status' })));
  for (let waited = 0; waited < 5000 && received === before && !closed; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { held: !closed && received > before, closed };
}

function startFixture() {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      const auth = String(request.headers.authorization ?? '');
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const streaming = body.stream === true;
      const message = { role: 'assistant', content: `FIXTURE_OK:${sha8(auth)}` };
      const chunk = {
        id: 'fixture-reply',
        object: streaming ? 'chat.completion.chunk' : 'chat.completion',
        created: 1,
        model: 'fixture-model',
        choices: [
          { index: 0, ...(streaming ? { delta: message } : { message }), finish_reason: 'stop' },
        ],
      };
      process.stdout.write(`${JSON.stringify({ request: 'completion', auth, streaming })}\n`);
      if (!streaming) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(chunk));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(80, '0.0.0.0', resolve);
  });
}

const CGROUP = '/sys/fs/cgroup';

const PROBES = {
  /** Tries each target once; blocked means nothing answered, not even a refusal. */
  connect: async ({ targets, timeoutMs = 3000 }) =>
    Promise.all(targets.map((target) => connectOnce(target, timeoutMs))),

  addresses: async () => ({
    ipv4: Object.entries(os.networkInterfaces()).flatMap(([iface, list]) =>
      (list ?? [])
        .filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => ({ iface, address: entry.address })),
    ),
    gateways: defaultGateways(readText('/proc/net/route')),
  }),

  /** Listens on the given ports until stopped. */
  listen: async () => {
    await listen([Number(process.env.PAH_LISTEN_PORT)]);
    process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
    return serveForever();
  },

  /** The model stand-in: an OpenAI-style completions endpoint that records who asked and with what key. */
  fixture: async () => {
    await startFixture();
    process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
    return serveForever();
  },

  tls: async ({ names, port, ca }) => {
    const out = {};
    for (const name of names) out[name] = await tlsHandshake({ port, servername: name, ca });
    return out;
  },
  tlsNoSni: async ({ port, ca }) => tlsHandshake({ port, ca }),

  http: async (args) => httpRequest(args),
  ws: async (args) => webSocketSession(args),
  wsHold: async (args) => holdWebSocket(args),

  /** What the unit's own process may do. */
  caps: async () => {
    const status = readText('/proc/self/status');
    const init = readText('/proc/1/status');
    const field = (name, text = status) =>
      new RegExp(`^${name}:\\s*(.*)$`, 'mu').exec(text)?.[1].trim();
    const attempt = (file) => {
      try {
        writeFileSync(file, 'x', { flag: 'wx' });
        unlinkSync(file);
        return 'written';
      } catch (error) {
        return error.code;
      }
    };
    return {
      uid: process.getuid(),
      capEff: field('CapEff'),
      capPrm: field('CapPrm'),
      capBnd: field('CapBnd'),
      noNewPrivs: field('NoNewPrivs'),
      init: { capEff: field('CapEff', init), noNewPrivs: field('NoNewPrivs', init) },
      writes: {
        etc: attempt('/etc/pah-probe'),
        opt: attempt('/opt/pah-probe'),
        tmp: attempt('/tmp/pah-probe'),
        state: attempt('/home/node/.personal/pah-probe'),
      },
      stateMode: (statSync('/home/node/.personal').mode & 0o777).toString(8),
      stateOwner: statSync('/home/node/.personal').uid,
    };
  },

  cgroup: async () => {
    const out = {};
    for (const file of [
      'memory.max',
      'memory.swap.max',
      'cpu.max',
      'pids.max',
      'pids.current',
      'memory.events',
      'cpu.stat',
      'pids.events',
    ]) {
      out[file] = readText(`${CGROUP}/${file}`).trim();
    }
    return out;
  },

  /** Allocates until the memory limit kills this process. */
  hog: async ({ mb }) => {
    const held = [];
    for (let allocated = 0; allocated < mb; allocated += 16) {
      held.push(Buffer.alloc(16 * 1024 * 1024, 1));
    }
    return { survived: true, held: held.length };
  },

  /** A busy loop for a while; reports the cpu time it was allowed. */
  burn: async ({ seconds }) => {
    const start = process.hrtime.bigint();
    const before = process.cpuUsage();
    let sink = 0;
    while (Number(process.hrtime.bigint() - start) / 1e9 < seconds) sink += Math.sqrt(sink + 1);
    const used = process.cpuUsage(before);
    return {
      wallMs: Number(process.hrtime.bigint() - start) / 1e6,
      cpuMs: (used.user + used.system) / 1000,
      sink: sink > 0,
    };
  },

  /** Starts sleeping children until the process limit stops it. */
  forkpids: async ({ max = 400 }) => {
    const children = [];
    let failure = null;
    for (let i = 0; i < max && failure === null; i += 1) {
      try {
        const child = spawn('sleep', ['40'], { stdio: 'ignore' });
        child.on('error', () => undefined);
        if (child.pid === undefined) failure = 'no pid';
        else children.push(child);
      } catch (error) {
        failure = String(error.code ?? error.message);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    const current = readText(`${CGROUP}/pids.current`).trim();
    const events = readText(`${CGROUP}/pids.events`).trim();
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    return { spawned: children.length, failure, current, events };
  },

  dnshttps: async () => {
    const address = await dns.promises.lookup('example.com', { family: 4 });
    const status = await new Promise((resolve) => {
      const request = https.get('https://example.com/', { timeout: 15000 }, (response) => {
        resolve(response.statusCode);
        response.resume();
      });
      request.once('timeout', () => request.destroy(new Error('timeout')));
      request.once('error', (error) => resolve(String(error.code ?? error.message)));
    });
    return { address: address.address, status };
  },

  /** How many processes of the engine host belong to a container's cgroup. */
  procs: async ({ id }) => {
    let count = 0;
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/u.test(entry)) continue;
      if (readText(`/proc/${entry}/cgroup`).includes(id)) count += 1;
    }
    return { count };
  },
};

async function probeMain([name, json]) {
  const probe = PROBES[name];
  if (probe === undefined) {
    process.stderr.write(`unknown probe ${name}\n`);
    process.exit(2);
  }
  const out = await probe(json ? JSON.parse(json) : {});
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// The orchestrator: installs, runs the checks, tears down.
// ---------------------------------------------------------------------------------------------

const BUNDLE_DIR = path.dirname(SCRIPT_PATH);
const RUN = randomBytes(3).toString('hex');
const SETTINGS = {
  baseDomain: 'agents.example.test',
  httpPort: Number(process.env.ACCEPTANCE_HTTP_PORT ?? 18080),
  httpsPort: Number(process.env.ACCEPTANCE_HTTPS_PORT ?? 18443),
  stateParent: '/var/lib',
  stateName: `pah-acceptance-${RUN}`,
  fixtureSubnet: '203.0.113.0/24',
  fixtureGateway: '203.0.113.1',
  fixtureAddress: '203.0.113.9',
};
const STATE_PATH = `${SETTINGS.stateParent}/${SETTINGS.stateName}`;
const CLI_IMAGE = 'docker:cli';
const BASE_IMAGE = 'alpine:3.22';
const PROBE_IMAGE = 'personal-agent-host:local';
const GUARD_IMAGE = 'personal-agent-host-guard:local';
const CONTROL = 'personal-agent-host-control-plane';
const PROXY = 'personal-agent-host-proxy';
const GUI_PORT = 7360;
const WS_PORT = 7361;
const METADATA_ADDRESS = '169.254.169.254';
const INSTALL_LABEL = 'robota.personal-agent-host.install';
const ACCOUNT_LABEL = 'robota.personal-agent-host.account';
const NAME = (suffix) => `pah-acc-${RUN}-${suffix}`;

const state = {
  repoRoot: undefined,
  installId: undefined,
  ca: undefined,
  keep: process.argv.includes('--keep'),
  children: [],
  containers: [],
  networks: [],
  metadataAdded: false,
  macListener: undefined,
  macConnections: 0,
  installerRan: false,
  originalUnitImage: undefined,
  builtImages: [],
  results: [],
};

class Failure extends Error {}
const expect = (condition, message) => {
  if (!condition) throw new Failure(message);
};

function run(command, args, { input, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: String(error.message), timedOut });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
      });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? '');
  });
}

/** Words of a static command line. Nothing with a space in it goes through this. */
const w = (text) => text.split(' ');
const docker = (args, options) => run('docker', args, options);

async function dockerOk(args, options) {
  const result = await docker(args, options);
  if (result.code !== 0) {
    const reason = result.timedOut ? 'timed out' : `exit ${result.code}`;
    const what = args.slice(0, 3).join(' ');
    throw new Failure(`docker ${what} failed (${reason}): ${result.stderr.trim().slice(0, 400)}`);
  }
  return result.stdout;
}

const dockerJson = async (args, options) => JSON.parse(await dockerOk(args, options));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A throwaway container without capabilities unless the flags add them. */
const helper = (flags, image, ...command) =>
  docker([
    'run',
    '--rm',
    ...w('--cap-drop ALL --security-opt no-new-privileges:true'),
    ...w(flags),
    image,
    ...command,
  ]);
const helperOk = async (...args) => {
  const result = await helper(...args);
  expect(
    result.code === 0,
    `${args[1]} ${args.slice(2).join(' ')}: ${result.stderr.trim().slice(0, 300)}`,
  );
  return result.stdout;
};
const NFT = (...command) =>
  helper('--network host --cap-add NET_ADMIN', GUARD_IMAGE, 'nft', ...command);

const LOCKDOWN = w(
  '--cap-drop ALL --security-opt no-new-privileges:true --read-only --memory 256m --pids-limit 128',
);

/** Where a probe runs: the proxy's host network, an unguarded bridge, the host's process table, or inside a container. */
const where = {
  host: { kind: 'host' },
  net: (network) => ({ kind: 'net', network }),
  pidHost: { kind: 'pidHost' },
  exec: (container) => ({ kind: 'exec', container }),
};

function probeCommand(place) {
  const node = w('--entrypoint node');
  const program = [PROBE_IMAGE, ...w('--input-type=module -')];
  if (place.kind === 'exec')
    return ['exec', '-i', place.container, 'node', ...w('--input-type=module -')];
  const network =
    place.kind === 'pidHost'
      ? w('--network none --pid host --cgroupns host')
      : ['--network', place.kind === 'host' ? 'host' : place.network];
  return ['run', '--rm', '-i', ...network, ...LOCKDOWN, ...node, ...program];
}

const scriptText = () => readFileSync(SCRIPT_PATH, 'utf8');

async function probe(place, name, arg = {}, { timeoutMs = 120_000, allowFailure = false } = {}) {
  const result = await docker([...probeCommand(place), 'probe', name, JSON.stringify(arg)], {
    input: scriptText(),
    timeoutMs,
  });
  if (allowFailure) return result;
  if (result.code !== 0) {
    throw new Failure(
      `probe ${name} failed (exit ${result.code}): ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  try {
    return JSON.parse(result.stdout.trim().split('\n').pop() ?? '');
  } catch {
    throw new Failure(`probe ${name} printed no result: ${result.stdout.slice(0, 200)}`);
  }
}

/** Runs a long-lived probe (a listener or the fixture) as a child, resolving once it is ready. */
async function startBackground(containerName, dockerFlags, probeName, onLine, arg = {}) {
  state.containers.push(containerName);
  const child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--name',
      containerName,
      ...dockerFlags,
      ...w('--entrypoint node'),
      PROBE_IMAGE,
      ...w('--input-type=module -'),
      'probe',
      probeName,
      JSON.stringify(arg),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  state.children.push(child);
  child.stdin.on('error', () => undefined);
  child.stdin.end(scriptText());
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  await new Promise((resolve, reject) => {
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.includes('"ready"')) resolve(undefined);
        else onLine?.(line);
      }
    });
    child.once('close', () =>
      reject(new Failure(`${containerName} stopped before it was ready: ${stderr.slice(0, 300)}`)),
    );
    setTimeout(() => reject(new Failure(`${containerName} was not ready in 60 s`)), 60_000);
  });
  return child;
}

// ---- reporting --------------------------------------------------------------------------------

function record(status, name, detail, seconds) {
  state.results.push({ status, name });
  const timing = seconds === undefined ? '' : `  (${seconds.toFixed(1)}s)`;
  process.stdout.write(`${status.padEnd(4)}  ${name}${timing}\n`);
  if (detail)
    for (const text of String(detail).split('\n')) process.stdout.write(`        ${text}\n`);
}

async function check(name, body, { always = false } = {}) {
  if (state.interrupted && !always) {
    record('SKIP', name, 'the run was interrupted');
    return;
  }
  const start = Date.now();
  try {
    const outcome = await body();
    const seconds = (Date.now() - start) / 1000;
    if (outcome?.skip) record('SKIP', name, outcome.skip, seconds);
    else record('PASS', name, typeof outcome === 'string' ? outcome : undefined, seconds);
  } catch (error) {
    const detail =
      error instanceof Failure ? error.message : `unexpected: ${error?.stack ?? error}`;
    record('FAIL', name, detail, (Date.now() - start) / 1000);
  }
}

const heading = (text) => process.stdout.write(`\n== ${text}\n`);
const lastResultPassed = () => state.results.at(-1)?.status === 'PASS';

// ---- engine and control-plane helpers -----------------------------------------------------------

const unitName = (account) => `pah-${state.installId}-${account}`;
const hostname = (account) => `${account}.${SETTINGS.baseDomain}`;
const publicOrigin = (account) => `https://${hostname(account)}:${SETTINGS.httpsPort}`;
const hostHeader = (account) => `${hostname(account)}:${SETTINGS.httpsPort}`;
const unitAddress = (account) => state.views[account].runtime.endpoints.host;

const cli = (args, input) =>
  docker(['exec', '-i', CONTROL, 'personal-agent-host', ...args], { input });

/** Like `cli`, for commands that restart units and may take minutes. */
const cliLong = (args, input) =>
  run('docker', ['exec', '-i', CONTROL, 'personal-agent-host', ...args], {
    input,
    timeoutMs: 10 * 60_000,
  });

/** A run whose output and input are bytes: an archive is not text, and `run` decodes it. */
function runBytes(command, args, { input, timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(error.message) });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? Buffer.alloc(0));
  });
}

const cliBytes = (args, input) =>
  runBytes('docker', ['exec', '-i', CONTROL, 'personal-agent-host', ...args], { input });

async function cliText(args) {
  const result = await cli(args);
  expect(
    result.code === 0,
    `personal-agent-host ${args[0]} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 300)}`,
  );
  return result.stdout;
}

async function cliJson(args, input) {
  const result = await cli([...args, '--json'], input);
  expect(
    result.code === 0,
    `personal-agent-host ${args[0]} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 300)}`,
  );
  return JSON.parse(result.stdout);
}

const show = (account) => cliJson(['show', account]);
const accessCode = async (account) => (await cliText(['access-code', account])).trim();

/** Reads a file of the host's state directory as the control plane sees it. */
async function stateFile(file) {
  const result = await docker(['exec', CONTROL, 'cat', `/var/lib/personal-agent-host/${file}`]);
  expect(result.code === 0, `cannot read ${file} in the control plane: ${result.stderr.trim()}`);
  return result.stdout;
}

/** The installer's own container: it runs install.sh (or compose down) against this engine as root. */
function installerContainer(command) {
  const env = {
    PERSONAL_AGENT_HOST_BASE_DOMAIN: SETTINGS.baseDomain,
    PERSONAL_AGENT_HOST_TLS: 'internal',
    PERSONAL_AGENT_HOST_ALLOW_CONTAINER: 'true',
    PERSONAL_AGENT_HOST_HTTP_PORT: String(SETTINGS.httpPort),
    PERSONAL_AGENT_HOST_HTTPS_PORT: String(SETTINGS.httpsPort),
    PERSONAL_AGENT_HOST_STATE_PATH: STATE_PATH,
    PERSONAL_AGENT_HOST_BIN_DIR: '/tmp/pah-bin',
  };
  const mounts = [
    '/var/run/docker.sock:/var/run/docker.sock',
    `${state.repoRoot}:${state.repoRoot}`,
    `${STATE_PATH}:${STATE_PATH}`,
  ];
  return docker(
    [
      ...w('run --rm --name'),
      NAME('installer'),
      ...mounts.flatMap((mount) => ['-v', mount]),
      ...['-w', BUNDLE_DIR],
      ...Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
      ...[CLI_IMAGE, 'sh', '-c', command],
    ],
    { timeoutMs: 45 * 60_000 },
  );
}

const labelFilters = (...labels) => labels.flatMap((label) => ['--filter', `label=${label}`]);

/** Every container, volume and network of the install (or of one account), as `kind name`. */
async function labelled(account) {
  const filters = labelFilters(
    `${INSTALL_LABEL}=${state.installId}`,
    ...(account === undefined ? [] : [`${ACCOUNT_LABEL}=${account}`]),
  );
  const lines = [];
  for (const [kind, command, format] of [
    ['container', w('ps -a'), '{{.Names}}'],
    ['volume', w('volume ls'), '{{.Name}}'],
    ['network', w('network ls'), '{{.Name}}'],
  ]) {
    const out = await dockerOk([...command, '--format', format, ...filters]);
    for (const name of out.split('\n').filter(Boolean)) lines.push(`${kind} ${name}`);
  }
  return lines;
}

const engineTime = async () => (await dockerOk(['info', '--format', '{{.SystemTime}}'])).trim();

// ---- probe vocabulary ---------------------------------------------------------------------------

const reachability = (from, targets, timeoutMs = 3000) =>
  probe(from, 'connect', { targets, timeoutMs }, { timeoutMs: timeoutMs + 60_000 });

const label = (targets) => {
  const names = targets.map((t) => `${t.host}:${t.port}`);
  return `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`;
};

/**
 * A negative check with its control. The control (a place the guard does not cover) must reach a
 * target for it to count as evidence; the probe place must then reach none of those.
 */
async function expectBlocked({ from, control, targets, who }) {
  const controlResults = await reachability(control, targets);
  const evidence = targets.filter((_, index) => reached(controlResults[index].outcome));
  expect(
    evidence.length > 0,
    `the control reached none of ${label(targets)}: the probe could not have succeeded`,
  );
  const verdict = judgeBlocked(targets, controlResults, await reachability(from, evidence));
  expect(verdict.leaked.length === 0, `reachable from ${who}: ${label(verdict.leaked)}`);
  expect(
    verdict.inconclusive.length === 0,
    `inconclusive from ${who} (neither blocked nor reached): ${label(verdict.inconclusive)}`,
  );
  return `${evidence.length} of ${targets.length} targets reached by the control, none from ${who}`;
}

// ---- setup ------------------------------------------------------------------------------------

async function preflight() {
  const server = JSON.parse(await dockerOk(['version', '--format', '{{json .Server}}']));
  expect(server.Os === 'linux', `the engine runs ${server.Os}; it must be Linux`);
  const [major, minor] = String(server.ApiVersion).split('.').map(Number);
  expect(major > 1 || minor >= 41, `engine API ${server.ApiVersion} is older than 1.41`);
  state.repoRoot = realpathSync(path.resolve(BUNDLE_DIR, '..', '..'));
  const settingsFile = path.join(BUNDLE_DIR, '.env');
  expect(!existsSync(settingsFile), `${settingsFile} exists: another install uses this checkout`);
  for (const name of [CONTROL, PROXY]) {
    const found = await dockerOk(['ps', '-a', '-q', '--filter', `name=^${name}$`]);
    expect(
      found.trim() === '',
      `a container named ${name} exists: an install is already running on this engine`,
    );
  }
  const volumes = await dockerOk(['volume', 'ls', '-q', '--filter', 'name=personal-agent-host_']);
  expect(
    volumes.trim() === '',
    `a volume of the bundle exists (${volumes.trim().split('\n')[0]}): an install is already present`,
  );
  const listening = await dockerOk([
    ...w('run --rm --network host'),
    BASE_IMAGE,
    ...w('netstat -ltn'),
  ]);
  for (const port of [SETTINGS.httpPort, SETTINGS.httpsPort]) {
    expect(
      !new RegExp(`:${port}\\s`, 'u').test(listening),
      `port ${port} is in use on the engine host (ACCEPTANCE_HTTP_PORT and ACCEPTANCE_HTTPS_PORT change it)`,
    );
  }
  const ids = (await dockerOk(w('network ls -q'))).split('\n').filter(Boolean);
  for (const network of await dockerJson(['network', 'inspect', ...ids])) {
    for (const config of network.IPAM?.Config ?? []) {
      expect(
        config.Subnet !== SETTINGS.fixtureSubnet,
        `the engine network ${network.Name} uses ${SETTINGS.fixtureSubnet}, which the model fixture needs`,
      );
    }
  }
  return `engine ${server.Version} (API ${server.ApiVersion}, ${server.Os}/${server.Arch})`;
}

async function install() {
  const made = await docker([
    ...w('run --rm -v'),
    `${SETTINGS.stateParent}:/v`,
    BASE_IMAGE,
    'mkdir',
    '-m',
    '755',
    `/v/${SETTINGS.stateName}`,
  ]);
  expect(made.code === 0, `cannot create ${STATE_PATH} on the engine host: ${made.stderr.trim()}`);
  state.installerRan = true;
  const result = await installerContainer('sh install.sh');
  const tail = (result.stdout + result.stderr).trim().split('\n').slice(-15).join('\n');
  expect(result.code === 0, `install.sh failed (exit ${result.code}):\n${tail}`);
  const accounts = await helperOk(
    `--network none -v ${STATE_PATH}:/s:ro`,
    BASE_IMAGE,
    'cat',
    '/s/accounts.json',
  );
  state.installId = JSON.parse(accounts).installId;
  const status = await cliText(['status']);
  expect(
    /^guard\s+verified/mu.test(status),
    `status: ${status.split('\n').slice(0, 3).join(' | ')}`,
  );
  return `install id ${state.installId}; the guard is verified; install.sh finished`;
}

async function startInfrastructure() {
  const unguarded = NAME('unguarded');
  await dockerOk(['network', 'create', unguarded]);
  state.networks.push(unguarded);
  state.unguardedNetwork = unguarded;

  const fixtureNetwork = NAME('fixture');
  await dockerOk([
    ...w('network create --subnet'),
    SETTINGS.fixtureSubnet,
    '--gateway',
    SETTINGS.fixtureGateway,
    '-o',
    'com.docker.network.bridge.gateway_mode_ipv4=nat-unprotected',
    fixtureNetwork,
  ]);
  state.networks.push(fixtureNetwork);
  state.fixtureLog = [];
  await startBackground(
    NAME('fixture'),
    [
      ...w('--network'),
      fixtureNetwork,
      '--ip',
      SETTINGS.fixtureAddress,
      ...w('--read-only --cap-drop ALL --security-opt no-new-privileges:true'),
    ],
    'fixture',
    (line) => state.fixtureLog.push(JSON.parse(line)),
  );

  const addresses = await probe(where.host, 'addresses');
  state.hostAddresses = addresses.ipv4;
  state.gateways = addresses.gateways;

  // The metadata address does not exist on this host, so a control could never reach it. It is added
  // to the loopback device for the run, where a listener on every address answers it.
  const present = await helper(
    '--network host',
    BASE_IMAGE,
    'sh',
    '-c',
    `ip -o -4 addr show dev lo | grep -q ${METADATA_ADDRESS}`,
  );
  if (present.code !== 0) {
    const added = await helper(
      '--network host --cap-add NET_ADMIN',
      BASE_IMAGE,
      ...w('ip addr add'),
      `${METADATA_ADDRESS}/32`,
      ...w('dev lo'),
    );
    expect(
      added.code === 0,
      `cannot add ${METADATA_ADDRESS} to the loopback device: ${added.stderr.trim()}`,
    );
    state.metadataAdded = true;
  }
  state.listenerPort = 19000 + Math.floor(Math.random() * 900);
  await startBackground(
    NAME('listener'),
    [
      ...w('--network host --read-only --cap-drop ALL'),
      '-e',
      `PAH_LISTEN_PORT=${state.listenerPort}`,
    ],
    'listen',
  );

  if (process.platform === 'darwin') {
    state.macPort = state.listenerPort + 1;
    state.macListener = net.createServer((socket) => {
      state.macConnections += 1;
      socket.on('error', () => undefined);
      socket.end('desktop\n');
    });
    await new Promise((resolve, reject) => {
      state.macListener.once('error', reject);
      state.macListener.listen(state.macPort, '127.0.0.1', resolve);
    });
  }
  return `fixture ${SETTINGS.fixtureAddress}, listener :${state.listenerPort}, ${state.hostAddresses.length} host addresses, gateways ${state.gateways.join(', ')}`;
}

const ACCOUNTS = {
  alice: w('--memory-mb 512 --cpus 0.5 --pids 128'),
  bob: [],
  carol: [],
  dave: [],
};

async function addAccount(account) {
  state.keys ??= {};
  state.views ??= {};
  state.keys[account] = `acceptance-fake-key-${account}-${randomBytes(8).toString('hex')}`;
  const provider = [
    ...w('--provider openai --model fixture-model --base-url'),
    `http://${SETTINGS.fixtureAddress}/v1`,
  ];
  const added = await cliJson(
    ['add', account, ...provider, ...ACCOUNTS[account]],
    state.keys[account],
  );
  expect(
    added.state === 'active' && added.runtime.state === 'running',
    `${account} did not start: ${added.state} / ${added.runtime.state}`,
  );
  state.views[account] = await show(account);
}

async function addFirstAccounts() {
  await addAccount('alice');
  await addAccount('bob');
  state.ca = (
    await docker(['exec', PROXY, 'cat', '/data/caddy/pki/authorities/local/root.crt'])
  ).stdout;
  expect(
    state.ca.includes('BEGIN CERTIFICATE'),
    'the proxy has not made its local certificate authority',
  );
  return `alice ${unitAddress('alice')}, bob ${unitAddress('bob')}`;
}

// ---- checks -----------------------------------------------------------------------------------

async function isolationChecks() {
  heading('Isolation');
  const a = unitAddress('alice');
  const b = unitAddress('bob');
  const fromA = where.exec(unitName('alice'));
  const fromB = where.exec(unitName('bob'));
  const unguarded = where.net(state.unguardedNetwork);
  const unitPorts = (host) => [GUI_PORT, WS_PORT].map((port) => ({ host, port }));

  await check(
    'isolation: account A cannot reach account B, nor B reach A (the proxy reaching them is the control)',
    async () => {
      const one = await expectBlocked({
        from: fromA,
        control: where.host,
        targets: unitPorts(b),
        who: 'A',
      });
      const two = await expectBlocked({
        from: fromB,
        control: where.host,
        targets: unitPorts(a),
        who: 'B',
      });
      return `${one}; ${two}`;
    },
  );

  await check(
    'isolation: A cannot reach any address of the engine host (an unguarded container reaches the same listener)',
    async () => {
      const targets = state.hostAddresses.map((entry) => ({
        host: entry.address,
        port: state.listenerPort,
      }));
      return expectBlocked({ from: fromA, control: unguarded, targets, who: 'A' });
    },
  );

  await check(
    'isolation: A cannot reach the proxy ports on any address of the engine host',
    async () => {
      const ports = [SETTINGS.httpPort, SETTINGS.httpsPort];
      const targets = state.hostAddresses.flatMap((entry) =>
        ports.map((port) => ({ host: entry.address, port })),
      );
      return expectBlocked({ from: fromA, control: unguarded, targets, who: 'A' });
    },
  );

  await check(
    'isolation: A cannot reach the metadata address (a listener on it is the control)',
    () =>
      expectBlocked({
        from: fromA,
        control: unguarded,
        targets: [{ host: METADATA_ADDRESS, port: state.listenerPort }],
        who: 'A',
      }),
  );

  await check("isolation: A cannot reach the engine host's default gateways", async () => {
    expect(state.gateways.length > 0, 'the engine host has no default route');
    const targets = state.gateways.map((host) => ({
      host,
      port: state.macPort ?? state.listenerPort,
    }));
    return expectBlocked({ from: fromA, control: unguarded, targets, who: 'A' });
  });

  await check(
    'isolation: A cannot reach the desktop host through the VM gateway (the desktop listener counts who connected)',
    async () => {
      if (state.macListener === undefined)
        return { skip: 'the engine does not run in a VM of this workstation' };
      const targets = [{ host: state.gateways[0], port: state.macPort }];
      const before = state.macConnections;
      const control = await reachability(unguarded, targets);
      expect(
        reached(control[0].outcome) && state.macConnections > before,
        'the control did not reach the desktop listener: the probe could not have succeeded',
      );
      const mid = state.macConnections;
      const result = await reachability(fromA, targets);
      expect(
        !reached(result[0].outcome) && state.macConnections === mid,
        'A reached the desktop host through the gateway',
      );
      return `the control made ${mid - before} connection to the desktop listener, A made none`;
    },
  );

  await check(
    'isolation: A cannot use a public resolver directly (DNS goes only to the engine host resolvers)',
    () =>
      expectBlocked({
        from: fromA,
        control: unguarded,
        targets: ['1.1.1.1', '8.8.8.8', '9.9.9.9'].map((host) => ({ host, port: 53 })),
        who: 'A',
      }),
  );

  await check(
    'isolation: the control plane has no network and nothing of it is mounted in a unit',
    async () => {
      const [plane] = await dockerJson(['inspect', CONTROL]);
      expect(
        plane.HostConfig.NetworkMode === 'none',
        `the control plane network mode is ${plane.HostConfig.NetworkMode}`,
      );
      const interfaces = async (container) => {
        const dev = (await docker(['exec', container, 'cat', '/proc/net/dev'])).stdout;
        return dev
          .split('\n')
          .slice(2)
          .map((line) => line.split(':')[0].trim())
          .filter(Boolean);
      };
      const own = await interfaces(CONTROL);
      expect(own.join() === 'lo', `the control plane has the interfaces ${own.join(', ')}`);
      expect(
        (await interfaces(PROXY)).length > 1,
        'the proxy shows no interface beyond loopback: the comparison has no control',
      );
      const paths = w('/var/run/docker.sock /var/lib/personal-agent-host');
      const there = await docker(['exec', CONTROL, 'ls', '-d', ...paths]);
      expect(
        there.code === 0,
        `the control plane does not see ${paths.join(', ')}: the comparison has no control`,
      );
      const inUnit = await docker([
        'exec',
        unitName('alice'),
        'sh',
        '-c',
        `ls -d ${paths.join(' ')} 2>/dev/null`,
      ]);
      expect(inUnit.stdout.trim() === '', `A sees ${inUnit.stdout.trim()}`);
      return 'the control plane has loopback only and mode none; the engine socket and the state directory exist there and in no unit';
    },
  );

  await check('isolation: A resolves a name and fetches one HTTPS page', async () => {
    const result = await probe(fromA, 'dnshttps', {}, { timeoutMs: 60_000 });
    expect(
      typeof result.status === 'number' && result.status < 500,
      `DNS gave ${result.address ?? 'nothing'}, the fetch gave ${result.status}`,
    );
    return `example.com resolved to ${result.address}; HTTPS answered ${result.status}`;
  });

  await check(
    'isolation: the shipped guard is in force and nothing was added for the fixture',
    async () => {
      const table = await NFT('list', 'table', 'inet', `pah_${state.installId}`);
      expect(table.code === 0, `cannot read the guard table: ${table.stderr.trim()}`);
      for (const range of [
        '10.0.0.0/8',
        '100.64.0.0/10',
        '169.254.0.0/16',
        '172.16.0.0/12',
        '192.168.0.0/16',
      ]) {
        expect(table.stdout.includes(range), `the guard table does not deny ${range}`);
      }
      expect(!table.stdout.includes('203.0.113'), 'the guard table mentions the fixture range');
      const chain = await NFT(...w('list chain ip filter DOCKER-USER'));
      expect(
        !/\baccept\b|\bdrop\b/u.test(chain.stdout),
        "the engine's chain for user rules holds a rule",
      );
      const user =
        chain.code === 0
          ? 'the engine chain for user rules is empty'
          : 'the engine has no chain for user rules';
      return `the table denies the private, carrier-grade NAT and link-local ranges and names no fixture address; ${user}`;
    },
  );
}

async function hardeningChecks() {
  heading('Hardening');
  for (const account of ['alice', 'bob']) {
    await check(
      `hardening: ${account}'s unit has no capability, no new privileges, a read-only root and no published port`,
      async () => {
        const [container] = await dockerJson(['inspect', unitName(account)]);
        const host = container.HostConfig;
        expect(
          host.CapDrop?.includes('ALL') && !host.CapAdd?.length,
          `capabilities: drop ${host.CapDrop}, add ${host.CapAdd}`,
        );
        expect(
          host.SecurityOpt?.includes('no-new-privileges:true'),
          `security options: ${host.SecurityOpt}`,
        );
        expect(
          host.ReadonlyRootfs === true && host.Privileged === false,
          'the root is writable or the unit is privileged',
        );
        const restarts = host.RestartPolicy.Name;
        expect(
          Object.keys(host.PortBindings ?? {}).length === 0 &&
            (restarts === '' || restarts === 'no'),
          `ports ${JSON.stringify(host.PortBindings)}, restart ${restarts}`,
        );
        expect(
          container.Mounts.length === 1 && container.Mounts[0].Type === 'volume',
          `mounts: ${container.Mounts.map((m) => m.Type)}`,
        );
        const live = await probe(where.exec(unitName(account)), 'caps');
        expect(
          /^0+$/u.test(live.capEff) && /^0+$/u.test(live.capBnd),
          `effective ${live.capEff}, bounding ${live.capBnd}`,
        );
        expect(live.noNewPrivs === '1', `NoNewPrivs ${live.noNewPrivs}`);
        expect(
          /^0+$/u.test(live.init.capEff) && live.init.noNewPrivs === '1',
          `the unit's first process has CapEff ${live.init.capEff}, NoNewPrivs ${live.init.noNewPrivs}`,
        );
        expect(live.uid !== 0, 'the unit runs as root');
        expect(
          live.writes.etc === 'EROFS' && live.writes.opt === 'EROFS',
          `writes to the root: ${JSON.stringify(live.writes)}`,
        );
        expect(
          live.writes.tmp === 'written' && live.writes.state === 'written',
          `/tmp and the state volume are not writable (the control): ${JSON.stringify(live.writes)}`,
        );
        expect(
          live.stateMode === '700' && live.stateOwner === live.uid,
          `the unit's state directory is ${live.stateMode}, owner ${live.stateOwner}`,
        );
        return `uid ${live.uid}, CapEff ${live.capEff}, NoNewPrivs ${live.noNewPrivs}; the root refuses writes (EROFS), /tmp and the state volume take them; state 700`;
      },
    );
  }

  await check(
    "hardening: the host's state is owner-only (another user is refused; root reading it is the control)",
    async () => {
      const stat =
        'cd /var/lib/personal-agent-host && stat -c "%a %n" . accounts.json audit.log secrets secrets/* proxy run';
      const listing = (await docker(['exec', CONTROL, 'sh', '-c', stat])).stdout;
      const modes = Object.fromEntries(
        listing
          .trim()
          .split('\n')
          .map((line) => line.split(' ').reverse()),
      );
      const directories = ['.', 'secrets', 'proxy', 'run'];
      const wrong = Object.entries(modes).filter(
        ([name, mode]) => mode !== (directories.includes(name) ? '700' : '600'),
      );
      expect(
        wrong.length === 0 && Object.keys(modes).length >= 8,
        `modes: ${wrong.map(([name, mode]) => `${name} ${mode}`).join(', ') || 'too few entries'}`,
      );
      const asRoot = await helper(
        `--network none -v ${STATE_PATH}:/s:ro`,
        BASE_IMAGE,
        'cat',
        '/s/accounts.json',
      );
      expect(asRoot.code === 0, 'root cannot read the state (the control)');
      const asOther = await helper(
        `--network none --user 12345:12345 -v ${STATE_PATH}:/s:ro`,
        BASE_IMAGE,
        'cat',
        '/s/accounts.json',
      );
      expect(
        asOther.code !== 0 && /denied/iu.test(asOther.stderr),
        `another user: exit ${asOther.code} ${asOther.stderr.trim()}`,
      );
      return `directories 700, files 600 (${Object.keys(modes).length} entries); uid 12345 gets permission denied`;
    },
  );
}

const tlsProbe = (names) =>
  probe(where.host, 'tls', { names, port: SETTINGS.httpsPort, ca: state.ca });

/** One request through the proxy, as a browser at the account's address would make it. */
const viaProxy = (account, extra) =>
  probe(where.host, 'http', {
    port: SETTINGS.httpsPort,
    servername: hostname(account),
    hostHeader: hostHeader(account),
    ca: state.ca,
    ...extra,
  });

/** What a WebSocket to the account's address needs: the address, the page's credential and its origin. */
const socketArguments = (account, extra) => ({
  port: SETTINGS.httpsPort,
  servername: hostname(account),
  hostHeader: hostHeader(account),
  ca: state.ca,
  origin: publicOrigin(account),
  wsPath: `${state.sessions[account].pathname}${state.sessions[account].search}`,
  ...extra,
});

const socket = (account, extra) =>
  probe(where.host, 'ws', socketArguments(account, extra), { timeoutMs: 180_000 });

async function tlsAndProxyChecks() {
  heading('TLS and the proxy');
  const known = ['alice', 'bob'].map(hostname);
  const unknown = `nobody.${SETTINGS.baseDomain}`;

  await check(
    'tls: known names get a certificate from the local CA, valid for the name',
    async () => {
      const result = await tlsProbe(known);
      for (const name of known) {
        const entry = result[name];
        expect(
          entry.handshake === 'ok' && entry.authorized === true,
          `${name}: ${JSON.stringify(entry)}`,
        );
        expect(
          entry.altNames.includes(`DNS:${name}`) && /Caddy Local Authority/u.test(entry.issuer),
          `${name}: names ${entry.altNames}, issuer ${entry.issuer}`,
        );
      }
      return `${known.join(' and ')} verified against the local CA`;
    },
  );

  await check(
    'tls: an unknown name, a name outside the domain and no name at all fail the handshake (a known name succeeds on the same port)',
    async () => {
      const names = [known[0], unknown, 'example.com'];
      const result = await tlsProbe(names);
      expect(
        result[known[0]].handshake === 'ok',
        `the control name failed: ${JSON.stringify(result[known[0]])}`,
      );
      for (const name of names.slice(1))
        expect(result[name].handshake === 'failed', `${name}: ${JSON.stringify(result[name])}`);
      const noName = await probe(where.host, 'tlsNoSni', {
        port: SETTINGS.httpsPort,
        ca: state.ca,
      });
      expect(noName.handshake === 'failed', `no name: ${JSON.stringify(noName)}`);
      const log = await docker(['logs', PROXY]);
      const issued = (name) =>
        (log.stdout + log.stderr)
          .split('\n')
          .filter(
            (line) =>
              line.includes(name) &&
              /obtain|issued/iu.test(line) &&
              !/error|no certificate/iu.test(line),
          );
      expect(
        issued(known[0]).length > 0,
        `the proxy log shows no issuance for ${known[0]}: the log check could not have succeeded`,
      );
      expect(issued(unknown).length === 0, `the proxy log shows issuance for ${unknown}`);
      return `refused with ${result[unknown].code}; the proxy log shows issuance for ${known[0]} and none for ${unknown}`;
    },
  );

  await check(
    'proxy: the access code logs in (a wrong code is refused, the session path needs the cookie)',
    async () => {
      state.sessions = {};
      for (const account of ['alice', 'bob']) {
        const page = await viaProxy(account, {});
        expect(
          page.status === 200 && page.body.includes('name="code"'),
          `login page: ${page.status ?? page.error}`,
        );
        const login = (code) =>
          viaProxy(account, {
            method: 'POST',
            requestPath: '/__monitor_login',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: `code=${encodeURIComponent(code)}`,
          });
        const wrong = await login('not-the-code');
        expect(wrong.status === 403, `a wrong code answered ${wrong.status ?? wrong.error}`);
        const right = await login(await accessCode(account));
        expect(right.status === 303, `the right code answered ${right.status ?? right.error}`);
        const cookie = String(right.headers['set-cookie'] ?? '');
        expect(
          /Secure/u.test(cookie) && /HttpOnly/u.test(cookie),
          'the session cookie is not Secure and HttpOnly',
        );
        const sessionPath = String(right.headers.location).split('#')[0];
        const without = await viaProxy(account, { requestPath: sessionPath });
        expect(
          without.status === 403,
          `the session path without the cookie answered ${without.status ?? without.error}`,
        );
        const index = await viaProxy(account, {
          requestPath: sessionPath,
          headers: { cookie: cookie.split(';')[0] },
        });
        expect(
          index.status === 200,
          `the session path with the cookie answered ${index.status ?? index.error}`,
        );
        const meta = /<meta name="ws-url" content="([^"]+)"/u.exec(index.body);
        expect(meta !== null, 'the page carries no WebSocket address');
        state.sessions[account] = new URL(meta[1].replaceAll('&amp;', '&'));
      }
      return 'both accounts: login page 200, wrong code 403, right code 303 with a Secure HttpOnly cookie, the session path 403 without it and 200 with it';
    },
  );

  await check(
    'proxy: a WebSocket upgrade works with the page credential and is refused with a wrong token or a foreign origin',
    async () => {
      const lines = [];
      for (const account of ['alice', 'bob']) {
        const good = await socket(account, {});
        expect(
          good.status === 101 && good.acceptOk === true && good.idle === true,
          `${account}: the upgrade answered ${good.status ?? good.error}, ${JSON.stringify(good).slice(0, 120)}`,
        );
        // The transport upgrades first and closes a connection with a wrong token before it sends
        // any session data; a refusal before the upgrade is as good.
        const wrongToken = await socket(account, {
          wsPath: `${state.sessions[account].pathname}?token=wrong`,
        });
        const refused =
          [401, 403].includes(wrongToken.status) ||
          (wrongToken.status === 101 &&
            wrongToken.closed === true &&
            wrongToken.frames.length === 0);
        expect(
          refused,
          `${account}: a wrong token got ${JSON.stringify(wrongToken).slice(0, 200)}`,
        );
        const foreign = await socket(account, { origin: 'https://evil.example.test' });
        expect(
          foreign.status === 403,
          `${account}: a foreign origin answered ${foreign.status ?? foreign.error}`,
        );
        lines.push(
          `${account}: 101 and idle, wrong token ${wrongToken.status === 101 ? 'closed with no data' : wrongToken.status}, foreign origin ${foreign.status}`,
        );
      }
      return lines.join('; ');
    },
  );

  // Every reload of the proxy that follows (adding, suspending, resuming and deleting an account,
  // a restarted unit) must leave this socket alone; the last check of the run asks it.
  await check('proxy: a WebSocket to bob is opened and held for the rest of the run', async () => {
    state.hold = { lines: [] };
    state.hold.child = await startBackground(
      NAME('hold'),
      [...w('--network host'), ...LOCKDOWN],
      'wsHold',
      (line) => state.hold.lines.push(line),
      socketArguments('bob', {}),
    );
    return 'the upgrade answered 101';
  });

  await check(
    "proxy: one model turn per account completes against the fixture with that account's own key",
    async () => {
      const lines = [];
      for (const account of ['alice', 'bob']) {
        const before = state.fixtureLog.length;
        const session = await socket(account, { prompt: 'Say hello', timeoutMs: 120_000 });
        expect(
          session.complete !== undefined,
          `${account}: no completed turn: ${JSON.stringify(session).slice(0, 300)}`,
        );
        const own = `Bearer ${state.keys[account]}`;
        expect(
          JSON.stringify(session.complete).includes(`FIXTURE_OK:${sha8(own)}`),
          `${account}: the reply does not carry the fixture marker of its own key`,
        );
        const calls = state.fixtureLog.slice(before);
        const others = calls.filter((call) => call.auth !== own).length;
        expect(
          calls.length > 0 && others === 0,
          `${account}: the fixture saw ${calls.length} requests, ${others} with another key`,
        );
        lines.push(`${account}: ${calls.length} fixture request(s), all with its own key`);
      }
      return lines.join('; ');
    },
  );

  await check(
    'proxy: the connector callback path reaches the right unit (the other unit refuses that host)',
    async () => {
      const callback = '/connector-callback?state=nothing-waits-for-this&code=x';
      const direct = (account, host) =>
        probe(where.host, 'http', {
          useTls: false,
          host: unitAddress(account),
          port: GUI_PORT,
          hostHeader: hostHeader(host),
          requestPath: callback,
        });
      const lines = [];
      for (const [account, other] of [
        ['alice', 'bob'],
        ['bob', 'alice'],
      ]) {
        const through = await viaProxy(account, { requestPath: callback });
        expect(
          through.status === 400 && /Nothing is waiting/u.test(through.body),
          `${account}: through the proxy ${through.status ?? through.error}`,
        );
        const wrong = await direct(other, account);
        expect(
          wrong.status === 403,
          `${other}'s unit answered ${wrong.status ?? wrong.error} for ${account}'s host: the check could not tell units apart`,
        );
        const right = await direct(account, account);
        expect(
          right.status === 400,
          `${account}'s own unit answered ${right.status ?? right.error}`,
        );
        lines.push(`${account}: 400 through the proxy and from its own unit, 403 from ${other}'s`);
      }
      return lines.join('; ');
    },
  );

  await check(
    'keys: each key is only in its own unit, and in no output, log, audit line, volume or proxy file',
    async () => {
      const environment = async (container) =>
        (await dockerJson(['inspect', container]))[0].Config.Env.join('\n');
      const envs = {
        alice: await environment(unitName('alice')),
        bob: await environment(unitName('bob')),
      };
      expect(
        envs.alice.includes(state.keys.alice) && envs.bob.includes(state.keys.bob),
        "a unit's environment lacks its own key (the control)",
      );
      const crossed = [
        ...findSecrets({ "bob's unit": envs.bob }, { alice: state.keys.alice }),
        ...findSecrets({ "alice's unit": envs.alice }, { bob: state.keys.bob }),
      ];
      expect(crossed.length === 0, crossed.join('; '));

      const texts = {
        'list output': await cliText(['list']),
        'list --json': JSON.stringify(await cliJson(['list'])),
        'show alice': await cliText(['show', 'alice']),
        'show bob --json': JSON.stringify(await cliJson(['show', 'bob'])),
        'status output': await cliText(['status']),
        'status --json': JSON.stringify(await cliJson(['status'])),
        'the audit log': await stateFile('audit.log'),
        "the proxy's configuration": await stateFile('proxy/Caddyfile'),
      };
      for (const container of [CONTROL, PROXY, unitName('alice'), unitName('bob')]) {
        const log = await docker(['logs', container]);
        texts[`the log of ${container}`] = log.stdout + log.stderr;
      }
      for (const container of [CONTROL, PROXY])
        texts[`the settings of ${container}`] = await environment(container);
      const leaks = findSecrets(texts, state.keys);
      expect(leaks.length === 0, leaks.join('; '));

      expect(
        (await stateFile('secrets/alice.json')).includes(state.keys.alice) &&
          (await stateFile('secrets/bob.json')).includes(state.keys.bob),
        'the secret store does not hold the keys (the control for this search)',
      );
      const stored = {
        'the secret of alice': await stateFile('secrets/alice.json'),
        'the secret of bob': await stateFile('secrets/bob.json'),
      };
      const crossStored = [
        ...findSecrets(
          { 'the secret of bob': stored['the secret of bob'] },
          { alice: state.keys.alice },
        ),
        ...findSecrets(
          { 'the secret of alice': stored['the secret of alice'] },
          { bob: state.keys.bob },
        ),
      ];
      expect(crossStored.length === 0, crossStored.join('; '));
      const scan = (account, patterns) =>
        docker(
          [
            // The volume's directory belongs to the unit's user (700), so the search runs as that user.
            ...w('run --rm -i --network none --cap-drop ALL --user 1000:1000 -v'),
            `pah-${state.installId}-${account}-state:/v:ro`,
            BASE_IMAGE,
            'sh',
            '-c',
            'grep -rlF -f /dev/stdin /v || true',
          ],
          { input: `${patterns}\n` },
        );
      for (const account of ['alice', 'bob']) {
        const keysFound = (await scan(account, Object.values(state.keys).join('\n'))).stdout.trim();
        expect(keysFound === '', `a key is in the volume of ${account}: ${keysFound}`);
        const codeFound = (await scan(account, await accessCode(account))).stdout;
        expect(
          codeFound.includes('server-access-code'),
          `the volume search could not find the access code of ${account} (the control)`,
        );
      }
      return `${Object.keys(texts).length} outputs, logs and files and both state volumes hold no key; each unit's environment holds its own only; the secret store and the volume search for the access code are the controls`;
    },
  );
}

async function lifecycleChecks() {
  heading('Lifecycle');
  const account = 'carol';
  let codeBefore;
  let containerId;
  const processes = async () => (await probe(where.pidHost, 'procs', { id: containerId })).count;
  const handshake = async (name) => (await tlsProbe([name]))[name];

  await check(
    'lifecycle: add carol; it runs, is labelled, is served and has processes (the controls for what follows)',
    async () => {
      await addAccount(account);
      containerId = (await dockerJson(['inspect', unitName(account)]))[0].Id;
      const objects = await labelled(account);
      expect(objects.length === 3, `labelled objects: ${objects.join(', ')}`);
      const count = await processes();
      expect(count > 0, 'no process in the unit cgroup (the control)');
      expect((await viaProxy(account, {})).status === 200, 'carol is not served');
      codeBefore = await accessCode(account);
      return `${objects.join(', ')}; ${count} processes in its cgroup`;
    },
  );

  await check(
    'lifecycle: suspend leaves no container and no process, only the volume and the unit network; the address answers 503',
    async () => {
      await cliJson(['suspend', account]);
      const objects = await labelled(account);
      expect(
        !objects.some((line) => line.startsWith('container')),
        `a container is left: ${objects.join(', ')}`,
      );
      expect(
        objects.length === 2 && objects.some((line) => line.startsWith('volume')),
        `left: ${objects.join(', ')}`,
      );
      expect((await processes()) === 0, 'processes of the unit are still running');
      const answer = await viaProxy(account, {});
      expect(
        answer.status === 503 && /suspended/u.test(answer.body),
        `the address answered ${answer.status ?? answer.error}`,
      );
      expect((await accessCode(account)) === codeBefore, 'the access code changed while suspended');
      return `left: ${objects.join(', ')}; 0 processes; 503 suspended; the access code is still readable`;
    },
  );

  await check(
    'lifecycle: resume keeps the access code and serves again with a valid certificate',
    async () => {
      await cliJson(['resume', account]);
      const view = await show(account);
      expect(
        view.state === 'active' &&
          view.runtime.state === 'running' &&
          view.runtime.healthy === true,
        `carol is ${view.state} / ${view.runtime.state}`,
      );
      expect(
        (await accessCode(account)) === codeBefore,
        'the access code changed across suspend and resume',
      );
      expect((await viaProxy(account, {})).status === 200, 'the address does not answer 200');
      const entry = await handshake(hostname(account));
      expect(
        entry.handshake === 'ok' && entry.authorized === true,
        `no valid certificate: ${JSON.stringify(entry)}`,
      );
      return 'the same access code; served again with a verified certificate';
    },
  );

  await check(
    'lifecycle: delete leaves nothing labelled, no file and no process, and the name stops getting a certificate',
    async () => {
      const result = await cli(['delete', account, '--confirm', account]);
      expect(result.code === 0, `delete failed: ${result.stderr.trim()}`);
      const left = await labelled(account);
      expect(left.length === 0, `left behind: ${left.join(', ')}`);
      const named = await dockerOk([
        'ps',
        '-a',
        '--filter',
        `name=${unitName(account)}`,
        '--format',
        '{{.Names}}',
      ]);
      expect(named.trim() === '', `a container named ${named.trim()} is left`);
      expect(
        (await docker(['volume', 'inspect', `${unitName(account)}-state`])).code !== 0,
        'the volume is left',
      );
      expect((await processes()) === 0, 'processes of the unit are still running');
      const secret = await docker([
        'exec',
        CONTROL,
        'test',
        '-e',
        `/var/lib/personal-agent-host/secrets/${account}.json`,
      ]);
      expect(secret.code !== 0, 'the secret file is left');
      expect(!(await cliText(['list'])).includes(account), 'the account is still listed');
      const entry = await handshake(hostname(account));
      expect(
        entry.handshake === 'failed',
        `the deleted name still handshakes: ${JSON.stringify(entry)}`,
      );
      return `no labelled object, container, volume, secret file or process; the handshake for ${hostname(account)} now fails (${entry.code})`;
    },
  );
}

async function limitChecks() {
  heading('Limits');
  const account = 'alice';
  const container = unitName(account);
  const fromA = where.exec(container);
  const { limits } = state.views[account];
  const cgroup = () => probe(fromA, 'cgroup');
  const counter = (text, name) =>
    Number(new RegExp(`^${name}\\s+(\\d+)`, 'mu').exec(text)?.[1] ?? 0);

  await check(
    "limits: each unit's cgroup values equal its account's limits (alice custom, bob the defaults)",
    async () => {
      const lines = [];
      for (const name of ['alice', 'bob']) {
        const want = state.views[name].limits;
        const have = await probe(where.exec(unitName(name)), 'cgroup');
        expect(
          Number(have['memory.max']) === want.memoryMb * 1024 * 1024,
          `${name}: memory.max ${have['memory.max']}`,
        );
        expect(
          have['memory.swap.max'] === '0',
          `${name}: memory.swap.max ${have['memory.swap.max']}`,
        );
        expect(
          have['cpu.max'] === `${Math.round(want.cpus * 100000)} 100000`,
          `${name}: cpu.max ${have['cpu.max']}`,
        );
        expect(Number(have['pids.max']) === want.pids, `${name}: pids.max ${have['pids.max']}`);
        lines.push(
          `${name}: ${want.memoryMb} MB without swap, ${want.cpus} CPUs (${have['cpu.max']}), ${want.pids} pids`,
        );
      }
      return lines.join('; ');
    },
  );

  await check(
    'limits: process exhaustion stays inside the unit (spawns work up to the limit, then fail; the other unit is unharmed)',
    async () => {
      const before = counter((await cgroup())['pids.events'], 'max');
      const result = await probe(fromA, 'forkpids', { max: 400 }, { timeoutMs: 120_000 });
      expect(
        result.spawned >= 20,
        `only ${result.spawned} processes started, so the probe could not have shown the limit (${result.failure})`,
      );
      expect(
        result.failure !== null && result.spawned < limits.pids,
        `${result.spawned} processes started with a limit of ${limits.pids}; failure: ${result.failure}`,
      );
      const after = counter((await cgroup())['pids.events'], 'max');
      expect(after > before, `pids.events max did not rise (${before} -> ${after})`);
      const healthy = (await Promise.all(['alice', 'bob'].map(show))).every(
        (view) => view.runtime.healthy === true,
      );
      expect(healthy, 'a unit is unhealthy after the exhaustion');
      return `${result.spawned} children started, then ${result.failure}; pids.events max ${before} -> ${after}; both units healthy`;
    },
  );

  await check(
    'limits: exceeding the memory limit is an OOM event that kills the hog, not the unit',
    async () => {
      const since = await engineTime();
      const before = counter((await cgroup())['memory.events'], 'oom_kill');
      const result = await probe(
        fromA,
        'hog',
        { mb: limits.memoryMb * 2 },
        { allowFailure: true, timeoutMs: 120_000 },
      );
      expect(!result.stdout.includes('survived'), 'the hog allocated twice the limit and survived');
      const after = counter((await cgroup())['memory.events'], 'oom_kill');
      const events = await dockerOk([
        'events',
        '--since',
        since,
        '--until',
        await engineTime(),
        '--filter',
        `container=${container}`,
        '--filter',
        'event=oom',
        '--format',
        '{{.Action}}',
      ]);
      expect(after > before, `memory.events oom_kill did not rise (${before} -> ${after})`);
      expect(events.includes('oom'), 'the engine reported no oom event');
      expect(
        (await show(account)).runtime.healthy === true,
        'the unit is not healthy after the OOM',
      );
      return `the hog exited ${result.code}; memory.events oom_kill ${before} -> ${after}; the engine emitted an oom event; the unit stays healthy`;
    },
  );

  await check('limits: a busy loop is throttled to the CPU limit', async () => {
    const before = counter((await cgroup())['cpu.stat'], 'nr_throttled');
    const burn = await probe(fromA, 'burn', { seconds: 4 }, { timeoutMs: 60_000 });
    const after = counter((await cgroup())['cpu.stat'], 'nr_throttled');
    expect(after > before, `nr_throttled did not rise (${before} -> ${after})`);
    const share = burn.cpuMs / burn.wallMs;
    expect(
      share <= limits.cpus * 1.3,
      `the loop got ${(share * 100).toFixed(0)}% of a CPU with a limit of ${limits.cpus * 100}%`,
    );
    return `a loop that wants 100% of a CPU got ${(share * 100).toFixed(0)}% (limit ${limits.cpus * 100}%); nr_throttled ${before} -> ${after}`;
  });

  await check(
    'limits: after the unit dies the reconcile loop restarts it with the same access code and it is served again',
    async () => {
      const codeBefore = await accessCode(account);
      const idBefore = (await dockerJson(['inspect', container]))[0].Id;
      const restarts = async () =>
        (
          (await stateFile('audit.log')).match(
            /"actor":"reconcile","command":"reconcile-start","account":"alice","result":"ok"/gu,
          ) ?? []
        ).length;
      const restartsBefore = await restarts();
      const killedAt = Date.now();
      await dockerOk(['kill', container]);
      for (;;) {
        await sleep(3000);
        const view = await show(account);
        const current = await docker(['inspect', '--format', '{{.Id}}', container]);
        if (
          view.runtime.state === 'running' &&
          view.runtime.healthy === true &&
          current.code === 0 &&
          current.stdout.trim() !== idBefore
        )
          break;
        expect(!state.interrupted, 'the run was interrupted');
        expect(
          Date.now() - killedAt < 240_000,
          `${account} is ${view.state} / ${view.runtime.state} 240 s after the kill`,
        );
      }
      const seconds = Math.round((Date.now() - killedAt) / 1000);
      expect(
        (await accessCode(account)) === codeBefore,
        'the access code changed across the restart',
      );
      const answer = await viaProxy(account, {});
      expect(
        answer.status === 200,
        `the address answered ${answer.status ?? answer.error} after the restart`,
      );
      expect(
        (await restarts()) > restartsBefore,
        'the audit log has no new reconcile start for alice',
      );
      return `killed; restarted by the reconcile loop after ${seconds} s (audited); the same access code; served with 200`;
    },
  );
}

async function reloadCheck() {
  heading('Live connections');
  await check(
    'proxy: the held WebSocket outlived every proxy reload of the run and still answers',
    async () => {
      const { child, lines } = state.hold;
      const ended = new Promise((resolve) => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([ended, sleep(30_000)]);
      const result = JSON.parse(lines.at(-1) ?? 'null');
      expect(result?.held === true, `the held socket: ${JSON.stringify(result)}`);
      return "bob's socket, opened before carol was added, stayed open through carol's add, suspend, resume and delete and alice's restart, and answered a request at the end";
    },
  );
}

// ---- operations: upgrade, backup and restore, health -------------------------------------------

const UNIT_TAG = 'personal-agent:local';
const volumeOf = (account) => `${unitName(account)}-state`;

/** The image id a unit's container was created from. */
async function containerImage(account) {
  return (await dockerJson(['inspect', unitName(account)]))[0].Image;
}

async function containerId(account) {
  return (await dockerJson(['inspect', unitName(account)]))[0].Id;
}

/** Whether the engine holds the control plane's retention tag for an image id. */
async function retained(imageId) {
  const tag = `pah-${state.installId}-images:${imageId.replace(/^sha256:/u, '').slice(0, 12)}`;
  const listed = await dockerOk(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']);
  return listed.split('\n').includes(tag);
}

/**
 * Rebuilds the unit image tag on top of the original image with a trivial change, as an operator's
 * rebuild would. The tag is put back at teardown.
 */
async function rebuildUnitImage(lines) {
  const dockerfile = [`FROM ${state.originalUnitImage}`, ...lines, ''].join('\n');
  const built = await docker(['build', '-q', '-t', UNIT_TAG, '-'], {
    input: dockerfile,
    timeoutMs: 10 * 60_000,
  });
  expect(built.code === 0, `building the test image failed: ${built.stderr.trim().slice(0, 300)}`);
  const id = (await dockerOk(['image', 'inspect', '--format', '{{.Id}}', UNIT_TAG])).trim();
  state.builtImages.push(id);
  return id;
}

/** A command inside a throwaway container with one account's state volume (and nothing else). */
const onVolume = (account, script) =>
  helper(
    `--network none --cap-add DAC_OVERRIDE -v ${volumeOf(account)}:/s`,
    BASE_IMAGE,
    'sh',
    '-c',
    script,
  );

async function readVolumeFile(account, file) {
  const result = await onVolume(account, `cat /s/${file}`);
  return result.code === 0 ? result.stdout : undefined;
}

async function volumeHas(account, file) {
  return (await onVolume(account, `test -e /s/${file}`)).code === 0;
}

async function unitIsServed(account) {
  const view = await show(account);
  expect(
    view.state === 'active' && view.runtime.state === 'running' && view.runtime.healthy === true,
    `${account} is ${view.state} / ${view.runtime.state}`,
  );
  const answer = await viaProxy(account, {});
  expect(answer.status === 200, `${account} answered ${answer.status ?? answer.error}`);
  return view;
}

async function operationsChecks() {
  heading('Operations: upgrade, backup and restore, health');
  const account = 'dave';
  const all = ['alice', 'bob', account];
  const codes = {};
  const memo = {};

  await check(
    'operations: dave is added, and every unit runs the image recorded for its account before anything is rebuilt',
    async () => {
      state.originalUnitImage = (
        await dockerOk(['image', 'inspect', '--format', '{{.Id}}', UNIT_TAG])
      ).trim();
      await addAccount(account);
      for (const name of all) {
        codes[name] = await accessCode(name);
        const view = await unitIsServed(name);
        expect(
          (await containerImage(name)) === view.imageId,
          `${name}: the unit runs ${await containerImage(name)}, the record says ${view.imageId}`,
        );
      }
      memo.first = (await show(account)).imageId;
      return `every unit runs the image recorded for it (${memo.first.slice(7, 19)})`;
    },
  );

  await check(
    'upgrade: rebuilding the image tag changes nothing for a running account by itself',
    async () => {
      memo.second = await rebuildUnitImage([`LABEL acceptance.upgrade="${RUN}"`]);
      expect(memo.second !== memo.first, 'the rebuilt tag names the same image id');
      const before = await containerId(account);
      await sleep(40_000); // longer than one reconcile pass
      const view = await unitIsServed(account);
      expect(view.imageId === memo.first, `the record moved to ${view.imageId}`);
      expect((await containerImage(account)) === memo.first, 'the unit now runs another image');
      expect((await containerId(account)) === before, 'the unit was restarted');
      return `the tag now names ${memo.second.slice(7, 19)}; the record and the running unit stay on ${memo.first.slice(7, 19)}`;
    },
  );

  await check(
    'upgrade: --all moves every active account to the rebuilt image, healthy, served and with the same access code; a second run leaves them alone',
    async () => {
      const result = await cliLong(['upgrade', '--all', '--json']);
      expect(
        result.code === 0,
        `upgrade --all failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 400)}`,
      );
      const moved = JSON.parse(result.stdout);
      expect(moved.target === memo.second, `the target is ${moved.target}`);
      expect(
        moved.moved
          .map((m) => m.id)
          .sort()
          .join() === [...all].sort().join(),
        `moved: ${JSON.stringify(moved.moved)}`,
      );
      for (const name of all) {
        const view = await unitIsServed(name);
        expect(view.imageId === memo.second, `${name} is recorded on ${view.imageId}`);
        expect((await containerImage(name)) === memo.second, `${name} runs another image`);
        expect((await accessCode(name)) === codes[name], `${name}: the access code changed`);
      }
      expect(await retained(memo.second), 'the new image has no retention tag');
      expect(
        !(await retained(memo.first)),
        'the previous image is still retained although no account is recorded on it',
      );
      const again = JSON.parse((await cliLong(['upgrade', '--all', '--json'])).stdout);
      expect(
        again.moved.length === 0 && again.current.length === all.length,
        `the second run: ${JSON.stringify(again)}`,
      );
      return `${all.join(', ')} moved to ${memo.second.slice(7, 19)} (200 each, same access codes); the previous image is released; a second run moved none`;
    },
  );

  await check(
    'upgrade: an image that never becomes healthy is rolled back; the account is served, the record and the access code are unchanged',
    async () => {
      memo.bad = await rebuildUnitImage(['ENTRYPOINT ["/bin/false"]', 'CMD []']);
      expect(memo.bad !== memo.second, 'the failing image has the same id');
      const container = await containerId(account);
      const failed = await cliLong(['upgrade', account]);
      expect(
        failed.code === 1,
        `exit ${failed.code}, not 1: ${(failed.stderr || failed.stdout).trim().slice(0, 300)}`,
      );
      expect(
        /previous image is running again/u.test(failed.stderr),
        `the failure does not say it rolled back: ${failed.stderr.trim().slice(0, 300)}`,
      );
      const view = await unitIsServed(account);
      expect(view.imageId === memo.second, `the record is ${view.imageId}, not ${memo.second}`);
      expect((await containerImage(account)) === memo.second, 'the unit runs another image');
      expect((await containerId(account)) !== container, 'the unit was never restarted');
      expect((await accessCode(account)) === codes[account], 'the access code changed');
      expect(!(await retained(memo.bad)), 'the failing image is still retained');
      expect(await retained(memo.second), 'the running image lost its retention tag');
      return `exit 1 with "the previous image is running again"; ${account} stays on ${memo.second.slice(7, 19)}, served with 200, the same access code; the failing image is not retained`;
    },
  );

  const marker = `before-${RUN}`;
  await check(
    'backup: the archive holds the state and the access code and never the model key, and the unit runs again',
    async () => {
      const written = await onVolume(account, `printf %s '${marker}' > /s/acceptance-marker`);
      expect(written.code === 0, `cannot write the marker: ${written.stderr.trim()}`);
      memo.code = await accessCode(account);
      const result = await cliBytes(['backup', account]);
      expect(result.code === 0, `backup failed (exit ${result.code}): ${result.stderr.trim()}`);
      memo.archive = result.stdout;
      expect(
        memo.archive.length > 0 && memo.archive.length % 512 === 0,
        `${memo.archive.length} bytes is not a tar`,
      );
      // The controls: the scan finds the marker and the access code, so it could have found a key.
      expect(memo.archive.includes(marker), 'the archive does not hold the state marker');
      expect(memo.archive.includes(memo.code), 'the archive does not hold the access code');
      expect(memo.archive.includes('manifest.json'), 'the archive has no manifest');
      for (const name of all)
        expect(!memo.archive.includes(state.keys[name]), `the archive holds ${name}'s model key`);
      await unitIsServed(account);
      return `${memo.archive.length} bytes with the state marker and the access code, no key; the unit was stopped for it and runs again (200)`;
    },
  );

  await check(
    "restore: a tampered archive is refused before anything is touched; the account's state and unit are as they were",
    async () => {
      const wrote = await onVolume(
        account,
        `printf %s 'after-${RUN}' > /s/acceptance-marker && printf x > /s/acceptance-extra && rm /s/server-access-code`,
      );
      expect(wrote.code === 0, `cannot change the state: ${wrote.stderr.trim()}`);
      const container = await containerId(account);
      const tampered = tamperArchive(memo.archive, marker);
      expect(!tampered.equals(memo.archive), 'the tampered copy equals the archive');
      const refused = await cliBytes(['restore', account], tampered);
      expect(
        refused.code === 3,
        `exit ${refused.code}, not 3 (refused): ${refused.stderr.trim().slice(0, 300)}`,
      );
      expect(
        /archive is refused/u.test(refused.stderr),
        `not refused as an archive: ${refused.stderr.trim().slice(0, 300)}`,
      );
      expect(
        (await readVolumeFile(account, 'acceptance-marker')) === `after-${RUN}`,
        'the state marker changed',
      );
      expect(await volumeHas(account, 'acceptance-extra'), 'the extra file is gone');
      expect(!(await volumeHas(account, 'server-access-code')), 'the access code file is back');
      expect((await containerId(account)) === container, 'the unit was restarted');
      await unitIsServed(account);
      return 'exit 3 "the archive is refused"; the marker, the extra file and the missing access code file are as they were; the unit never restarted. The next check restores the untampered archive, which proves this one could have succeeded';
    },
  );

  await check(
    'restore: the untampered archive (the control for the refusal above) brings back the state and the access code, keeps the stored key, and the account is served',
    async () => {
      const container = await containerId(account);
      const result = await cliBytes(['restore', account, '--json'], memo.archive);
      expect(
        result.code === 0,
        `restore failed (exit ${result.code}): ${result.stderr.trim().slice(0, 300)}`,
      );
      const restored = JSON.parse(result.stdout.toString('utf8'));
      expect(
        restored.account === account && restored.restarted === true,
        `restore result: ${result.stdout.toString('utf8').slice(0, 200)}`,
      );
      expect(
        (await readVolumeFile(account, 'acceptance-marker')) === marker,
        'the state marker was not restored',
      );
      expect(
        !(await volumeHas(account, 'acceptance-extra')),
        'the extra file survived the restore',
      );
      expect((await accessCode(account)) === memo.code, 'the access code is not the backed-up one');
      expect((await containerId(account)) !== container, 'the unit was not restarted');
      const view = await unitIsServed(account);
      expect(view.imageId === memo.second, `the record is ${view.imageId}`);
      expect(
        (await dockerOk(['inspect', unitName(account)])).includes(state.keys[account]),
        'the unit was not started with its stored key',
      );
      return 'the marker is back, the extra file is gone, the access code equals the backed-up one, the unit restarted on its recorded image with its stored key and answers 200';
    },
  );

  await check(
    'health: exits 0 with one line when the guard is verified, the routes are current and every unit is running and healthy',
    async () => {
      const result = await cli(['health']);
      expect(
        result.code === 0,
        `health exit ${result.code}: ${(result.stdout + result.stderr).trim().slice(0, 400)}`,
      );
      expect(
        /^healthy: /u.test(result.stdout) && result.stdout.trim().split('\n').length === 1,
        `output: ${result.stdout.trim()}`,
      );
      const report = JSON.parse((await cli(['health', '--json'])).stdout);
      expect(report.healthy === true && report.checked === all.length, JSON.stringify(report));
      return result.stdout.trim();
    },
  );

  await check(
    'health: a unit stopped behind the control plane gives exit 6 and one line naming it; after the reconcile loop restarts it, exit 0 and the restart shows in status',
    async () => {
      const container = unitName(account);
      let sick;
      let stoppedAt = 0;
      // The reconcile loop could repair it between the stop and the question; then stop it again.
      for (let attempt = 0; attempt < 3 && sick === undefined; attempt += 1) {
        stoppedAt = Date.now();
        await dockerOk(['stop', '-t', '1', container]);
        const answer = await cli(['health']);
        if (answer.code !== 0) sick = answer;
      }
      expect(sick !== undefined, 'health stayed 0 although the unit was stopped three times');
      expect(sick.code === 6, `exit ${sick.code}, not 6`);
      const lines = sick.stdout.trim().split('\n');
      expect(
        lines.length === 1 && /^dave: the unit is \w+ but the account is active$/u.test(lines[0]),
        `output: ${sick.stdout.trim()}`,
      );
      for (;;) {
        await sleep(3000);
        if ((await cli(['health'])).code === 0) break;
        expect(!state.interrupted, 'the run was interrupted');
        expect(Date.now() - stoppedAt < 240_000, 'health is still not 0 240 s after the stop');
      }
      const seconds = Math.round((Date.now() - stoppedAt) / 1000);
      const status = await cliJson(['status']);
      const entry = status.accounts.find((a) => a.id === account);
      expect(
        entry.lastRestartAt !== null && Date.parse(entry.lastRestartAt) >= stoppedAt - 5000,
        `status shows lastRestartAt ${entry.lastRestartAt}`,
      );
      expect(entry.backoff === null, `status shows a backoff: ${JSON.stringify(entry.backoff)}`);
      await unitIsServed(account);
      return `exit 6 with "${lines[0]}"; exit 0 again ${seconds} s after the stop; status shows the restart at ${entry.lastRestartAt}; served with 200`;
    },
  );
}

// ---- teardown ---------------------------------------------------------------------------------

async function teardown() {
  // The unit image tag goes back to what it named before the run, also when the install stays up.
  if (state.originalUnitImage !== undefined) {
    const back = await docker(['tag', state.originalUnitImage, UNIT_TAG]);
    if (back.code !== 0) {
      process.stdout.write(
        `  could not point ${UNIT_TAG} back at ${state.originalUnitImage}: ${back.stderr.trim().slice(0, 200)}\n`,
      );
    }
  }
  if (state.keep) {
    process.stdout.write(
      `\n== --keep: the install stays up (state ${STATE_PATH}, install id ${state.installId}); remove it with the guide's removal steps\n`,
    );
    return;
  }
  heading('Teardown');
  const step = async (name, work) => {
    try {
      await work();
    } catch (error) {
      process.stdout.write(
        `  teardown step failed (${name}): ${String(error.message ?? error).slice(0, 200)}\n`,
      );
    }
  };
  for (const child of state.children) child.kill('SIGTERM');
  state.macListener?.close();
  for (const name of state.containers)
    await step(`remove ${name}`, () => docker(['rm', '-f', name]));
  if (state.ca !== undefined) {
    for (const account of ['alice', 'bob', 'carol', 'dave'])
      await step(`delete ${account}`, () => cli(['delete', account, '--confirm', account]));
  }
  if (state.installerRan) {
    await step('compose down', () => installerContainer('docker compose down -v && rm -f .env'));
  }
  if (state.installId !== undefined) {
    await step('labelled objects', async () => {
      const filters = labelFilters(`${INSTALL_LABEL}=${state.installId}`);
      for (const [list, remove] of [
        [w('ps -a -q'), w('rm -f')],
        [w('volume ls -q'), w('volume rm -f')],
        [w('network ls -q'), w('network rm')],
      ]) {
        const ids = (await dockerOk([...list, ...filters])).split('\n').filter(Boolean);
        if (ids.length > 0) await docker([...remove, ...ids]);
      }
    });
    await step('firewall table', () => NFT('delete', 'table', 'inet', `pah_${state.installId}`));
  }
  if (state.metadataAdded) {
    await step('metadata address', () =>
      helper(
        '--network host --cap-add NET_ADMIN',
        BASE_IMAGE,
        ...w('ip addr del'),
        `${METADATA_ADDRESS}/32`,
        ...w('dev lo'),
      ),
    );
  }
  for (const network of state.networks)
    await step(`network ${network}`, () => docker(['network', 'rm', network]));
  // The images the operations checks built; the original stays, and so does everything it was built from.
  for (const id of new Set(state.builtImages)) await step(`image ${id}`, () => docker(['rmi', id]));
  if (state.installerRan) {
    await step('state directory', () =>
      docker([
        ...w('run --rm -v'),
        `${SETTINGS.stateParent}:/v`,
        BASE_IMAGE,
        'rm',
        '-rf',
        `/v/${SETTINGS.stateName}`,
      ]),
    );
  }
}

/** What of this run is still on the engine or the host. */
async function leftovers() {
  const names = async (command) =>
    (await dockerOk([...command, '--format', '{{.Name}}'])).split('\n').filter(Boolean);
  const mine = (name) =>
    name.startsWith(`pah-acc-${RUN}`) ||
    (state.installId !== undefined && name.startsWith(`pah-${state.installId}-`));
  const left = [];
  for (const name of (await dockerOk(w('ps -a --format {{.Names}}'))).split('\n')) {
    if (name === CONTROL || name === PROXY || mine(name)) left.push(`container ${name}`);
  }
  for (const name of await names(w('volume ls')))
    if (name.startsWith('personal-agent-host_') || mine(name)) left.push(`volume ${name}`);
  for (const name of await names(w('network ls'))) if (mine(name)) left.push(`network ${name}`);
  if (state.installId !== undefined) {
    const tables = await NFT('list', 'tables');
    if (tables.stdout.includes(`pah_${state.installId}`))
      left.push(`firewall table pah_${state.installId}`);
  }
  if (state.installId !== undefined) {
    const images = await dockerOk([
      ...w('image ls --format {{.Repository}}:{{.Tag}}'),
      '--filter',
      `reference=pah-${state.installId}-images`,
    ]);
    for (const name of images.split('\n').filter(Boolean)) left.push(`image tag ${name}`);
  }
  const lo = await helper('--network host', BASE_IMAGE, ...w('ip -o -4 addr show dev lo'));
  if (state.metadataAdded && lo.stdout.includes(METADATA_ADDRESS))
    left.push(`address ${METADATA_ADDRESS} on lo`);
  const parent = await helper(`-v ${SETTINGS.stateParent}:/v:ro`, BASE_IMAGE, 'ls', '/v');
  if (parent.stdout.split('\n').includes(SETTINGS.stateName))
    left.push(`state directory ${STATE_PATH}`);
  if (existsSync(path.join(BUNDLE_DIR, '.env'))) left.push('the installer settings file');
  return left;
}

// ---- main -------------------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const onSignal = () => {
    process.stdout.write('\ninterrupted: tearing down\n');
    state.interrupted = true;
  };
  // Not `once`: a second signal must not end the process before the teardown has run.
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  heading(
    `Install (local certificate authority, ports ${SETTINGS.httpPort} and ${SETTINGS.httpsPort})`,
  );
  try {
    await check(
      'install: preflight finds no other install, free ports and a free fixture subnet',
      preflight,
    );
    if (lastResultPassed())
      await check(
        'install: install.sh builds the images and starts the control plane and the proxy',
        install,
      );
    if (lastResultPassed())
      await check(
        'install: the model fixture, the unguarded control network, the listeners and the metadata address are up',
        startInfrastructure,
      );
    if (lastResultPassed())
      await check(
        'install: alice (512 MB, 0.5 CPU, 128 pids) and bob (defaults) are added and running',
        addFirstAccounts,
      );
    if (lastResultPassed() && !state.interrupted) {
      await isolationChecks();
      await hardeningChecks();
      await tlsAndProxyChecks();
      await lifecycleChecks();
      await limitChecks();
      if (state.hold?.child !== undefined) await reloadCheck();
      await operationsChecks();
    } else {
      process.stdout.write('\nsetup did not finish: the checks were not run\n');
    }
  } catch (error) {
    record(
      'FAIL',
      'run',
      error instanceof Failure ? error.message : `unexpected: ${error?.stack ?? error}`,
    );
  } finally {
    await teardown();
  }
  if (!state.keep) {
    await check(
      'teardown: nothing of the run is left (containers, volumes, networks, image retention tags, firewall table, address, state directory, settings file)',
      async () => {
        const left = await leftovers();
        expect(left.length === 0, `left behind: ${left.join(', ')}`);
        return 'the engine and the host are as they were before the run; the images are kept';
      },
      { always: true },
    );
  }
  const count = (status) => state.results.filter((result) => result.status === status).length;
  const seconds = Math.round((Date.now() - started) / 1000);
  const elapsed = `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
  process.stdout.write(
    `\nResult: ${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIP')} skipped in ${elapsed}\n`,
  );
  process.exitCode = count('FAIL') > 0 ? 1 : 0;
}

if (process.argv[2] === 'probe') await probeMain(process.argv.slice(3));
else if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === SCRIPT_PATH)
  await main();
