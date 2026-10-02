/** Runs inside the disposable guest; never prints the daemon URL/token or payload. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import WebSocket from '/home/researcher/cli/node_modules/ws/index.js';

const first = JSON.parse(readFileSync('/home/researcher/daemon-start.json', 'utf8'));
const second = JSON.parse(readFileSync('/home/researcher/daemon-reuse.json', 'utf8'));
assert(first.id === second.id && first.url === second.url, 'Second start must reuse the same daemon');
const base = new URL(first.url);
assert(base.hostname === '127.0.0.1' && base.searchParams.get('token'));
const probe = (url, headers) => new Promise(resolve => {
  const ws = new WebSocket(url, { headers });
  let settled = false;
  const done = result => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    ws.on('error', () => {}); ws.terminate(); resolve(result);
  };
  const timer = setTimeout(() => done('timeout'), 5000);
  ws.on('message', () => done('received-session-data'));
  ws.on('error', () => done('refused'));
  ws.on('unexpected-response', (_, response) => { response.resume(); done('refused'); });
  ws.on('close', () => done('closed-without-session-data'));
});
const missing = new URL(base); missing.search = '';
const wrong = new URL(base); wrong.searchParams.set('token', 'synthetic-wrong-token');
const records = [];
for (const [id, url, headers, expected] of [
  ['token-missing', missing.href, {}, 'refused'],
  ['token-wrong', wrong.href, {}, 'refused'],
  ['origin-untrusted', base.href, { Origin: 'https://attacker.invalid' }, 'refused'],
  ['host-untrusted', base.href, { Host: 'attacker.invalid' }, 'refused'],
  ['token-valid', base.href, {}, 'received-session-data'],
]) {
  const observed = await probe(url, headers);
  const passed = expected === 'refused' ? ['refused', 'closed-without-session-data'].includes(observed) : observed === expected;
  records.push({ id, expected, observed, passed });
  assert(passed, id);
}
process.stdout.write(JSON.stringify({ kind: 'actual-cli-daemon-guest-auth', daemonReused: true, records,
  limitations: ['Loopback authentication is verified; remote UI authentication and hosted organization policy remain separate work.'] }, null, 2) + '\n');
