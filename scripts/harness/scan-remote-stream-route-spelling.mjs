#!/usr/bin/env node

/**
 * The remote streaming route is spelled ONCE — CORE-046.
 *
 * ## The failure this prevents
 *
 * Remote streaming was a 404 dressed as a capability for as long as it existed. The client posted to
 * `${baseUrl}/stream`, a sibling module named `/chat/stream`, `apps/agent-server/src/app.ts` and its
 * SPEC both claimed the route was inlined, and **no server served either spelling**. Every call
 * failed, and the suite was green because the client's tests drove a mocked `fetch` — a mocked
 * transport agrees with whatever the client says, so it cannot notice that the far end is absent.
 *
 * ## Why a scan rather than a test
 *
 * The invariant spans two packages that must NOT import each other. `apps/agent-server` is a server
 * composition root and is forbidden from depending on a remote client (`agent-server-boundary`), and
 * the reverse edge is worse. So no single test can hold both values — which is exactly the shape of
 * invariant a harness scan exists for, and exactly why the disagreement survived: nobody could
 * compare the two sides from inside either one.
 *
 * ## What it compares
 *
 * The server's `REMOTE_CHAT_STREAM_PATH` must equal the API prefix plus the client's
 * `REMOTE_CHAT_STREAM_SUFFIX`. Both are read from source as literals, so renaming either one without
 * the other fails here rather than at runtime against a user.
 *
 * Exit 0 = the two agree, 1 = they do not, or a declaration could not be found.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

const SERVER_FILE = 'apps/agent-server/src/routes/provider-chat-stream.ts';
const CLIENT_FILE = 'packages/agent-remote-client/src/client/chat-stream-http.ts';

/** The client is configured with a base URL that already carries this prefix. */
const CLIENT_BASE_PREFIX = '/api/v1/remote';

/** Read `export const <name> = '<value>';` out of a source file. */
export function readStringConstant(source, name) {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`));
  return match ? match[1] : undefined;
}

/**
 * The files the last run actually READ — measurement-provenance.md.
 *
 * Reset at the top of each run rather than appended to across runs, so an accumulating counter is
 * told apart from a growing subject: a second call over the same tree must report the same number.
 */
let examined = [];

/** @returns how many declaration files the most recent {@link findRouteSpellingFindings} call read. */
export function examinedDeclarationCount() {
  return examined.length;
}

export function findRouteSpellingFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['apps', 'packages'], {
    scan: 'remote-stream-route-spelling',
    why: 'the check compares a server route to a client path; with neither tree present there is nothing to compare.',
  });

  examined = [];
  const findings = [];
  const serverPath = path.join(root, SERVER_FILE);
  const clientPath = path.join(root, CLIENT_FILE);

  // Fail closed. A missing file means the route or the client was moved, which is precisely when a
  // spelling drifts — reporting "nothing to check" would restore the silence this scan replaces.
  for (const [label, file] of [
    ['server route', serverPath],
    ['client request', clientPath],
  ]) {
    if (!existsSync(file)) {
      findings.push({
        type: 'remote-stream-file-missing',
        detail: `${label} file not found at ${path.relative(root, file)} — the route may have moved; update this scan with it rather than leaving the two sides uncompared.`,
      });
    }
  }
  if (findings.length > 0) return findings;

  examined = [SERVER_FILE, CLIENT_FILE];
  const served = readStringConstant(readFileSync(serverPath, 'utf8'), 'REMOTE_CHAT_STREAM_PATH');
  const suffix = readStringConstant(readFileSync(clientPath, 'utf8'), 'REMOTE_CHAT_STREAM_SUFFIX');

  if (served === undefined) {
    findings.push({
      type: 'remote-stream-declaration-missing',
      detail: `${SERVER_FILE} declares no REMOTE_CHAT_STREAM_PATH string literal.`,
    });
  }
  if (suffix === undefined) {
    findings.push({
      type: 'remote-stream-declaration-missing',
      detail: `${CLIENT_FILE} declares no REMOTE_CHAT_STREAM_SUFFIX string literal.`,
    });
  }
  if (findings.length > 0) return findings;

  const posted = `${CLIENT_BASE_PREFIX}${suffix}`;
  if (posted !== served) {
    findings.push({
      type: 'remote-stream-spelling-mismatch',
      detail: `the client posts to "${posted}" and the server serves "${served}". Every remote streaming call would 404 — the exact state CORE-046 fixed, which survived because a mocked \`fetch\` cannot notice a missing far end.`,
    });
  }
  return findings;
}

function main() {
  const findings = findRouteSpellingFindings();
  console.log(`::examined:: ${examinedDeclarationCount()} route-spelling declaration(s)`);
  if (findings.length === 0) {
    console.log('remote stream route spelling scan passed (client and server agree).');
    return;
  }
  console.error(`remote stream route spelling scan failed: ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- [${finding.type}] ${finding.detail}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
