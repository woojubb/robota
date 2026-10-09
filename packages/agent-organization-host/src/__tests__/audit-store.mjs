import { createServer } from 'node:http';
import { createPrivateKey, sign } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  OrganizationAuditAppendConflict,
  organizationCanonical,
  organizationAuditHash,
  organizationAuditSigningBytes,
  verifyOrganizationAudit,
} from '../../dist/node/index.js';

let db;
let server;
let config;
let signer;
let rejectCas = false;
let stopped = false;
const same = (a, b) => organizationCanonical(a) === organizationCanonical(b);
function stored() {
  return JSON.parse(db.prepare('SELECT value FROM head WHERE id=1').get().value);
}
function checkpoint(claims) {
  return {
    claims,
    signature: sign(null, organizationAuditSigningBytes(claims), signer).toString('base64url'),
  };
}
function verifyHead(value) {
  verifyOrganizationAudit([], value, value, config.publicKey, config.stream);
}
function shutdown() {
  if (stopped) return;
  stopped = true;
  if (!server) {
    db?.close();
    process.disconnect();
    return;
  }
  server.closeAllConnections();
  server.close(() => {
    db.close();
    process.disconnect();
  });
}
process.on('SIGTERM', shutdown);
process.on('message', async (message) => {
  if (message.kind === 'stop') {
    shutdown();
    return;
  }
  if (message.kind === 'reject-cas') {
    rejectCas = true;
    process.send({ kind: 'configured' });
    return;
  }
  if (message.kind !== 'start') return;
  try {
    config = message.options;
    if (config.bootstrap) closeSync(openSync(config.path, 'wx', 0o600));
    db = new DatabaseSync(config.path, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
    });
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    if (config.bootstrap) {
      verifyHead(config.genesis);
      db.exec(
        'CREATE TABLE head(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL) STRICT; CREATE TABLE entries(sequence INTEGER PRIMARY KEY,value TEXT NOT NULL) STRICT;',
      );
      db.prepare('INSERT INTO head VALUES(1,?)').run(organizationCanonical(config.genesis));
    }
    verifyHead(stored());
    if (config.role === 'sink') signer = createPrivateKey(config.privateKey);
    server = createServer((request, response) => {
      void (async () => {
        try {
          if (request.method !== 'POST') throw new Error('method');
          let size = 0;
          const chunks = [];
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 64 * 1024) throw new Error('body cap');
            chunks.push(chunk);
          }
          const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          let output;
          if (config.role === 'sink' && request.url === '/read') {
            output = {
              entries: db
                .prepare('SELECT value FROM entries WHERE sequence>? ORDER BY sequence')
                .all(input.sequence)
                .map((row) => JSON.parse(row.value)),
              head: stored(),
            };
          } else if (config.role === 'sink' && request.url === '/append') {
            db.exec('BEGIN IMMEDIATE');
            try {
              const current = stored();
              if (!same(input.expected, current.claims))
                throw new OrganizationAuditAppendConflict();
              const sequence = current.claims.sequence + 1;
              const entry = {
                stream: config.stream,
                sequence,
                previous: current.claims.hash,
                event: input.event,
                hash: organizationAuditHash(
                  config.stream,
                  sequence,
                  current.claims.hash,
                  input.event,
                ),
              };
              const head = checkpoint({
                version: 1,
                stream: config.stream,
                sequence,
                hash: entry.hash,
              });
              db.prepare('INSERT INTO entries VALUES(?,?)').run(
                sequence,
                organizationCanonical(entry),
              );
              db.prepare('UPDATE head SET value=? WHERE id=1').run(organizationCanonical(head));
              db.exec('COMMIT');
              output = { entry, head };
            } catch (error) {
              db.exec('ROLLBACK');
              throw error;
            }
          } else if (config.role === 'anchor' && request.url === '/load') {
            output = stored();
          } else if (config.role === 'anchor' && request.url === '/cas') {
            if (rejectCas) {
              rejectCas = false;
              throw new Error('fixture anchor unavailable');
            }
            verifyHead(input.next);
            db.exec('BEGIN IMMEDIATE');
            try {
              const current = stored();
              const accepted =
                same(input.expected, current.claims) &&
                input.next.claims.sequence > current.claims.sequence;
              if (accepted)
                db.prepare('UPDATE head SET value=? WHERE id=1').run(
                  organizationCanonical(input.next),
                );
              db.exec('COMMIT');
              output = accepted;
            } catch (error) {
              db.exec('ROLLBACK');
              throw error;
            }
          } else throw new Error('route');
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(organizationCanonical(output));
        } catch (error) {
          response.writeHead(error instanceof OrganizationAuditAppendConflict ? 409 : 503, {
            'content-type': 'application/json',
          });
          response.end('{"refused":"fixture-storage"}');
        }
      })();
    });
    server.requestTimeout = 2000;
    server.listen(0, '127.0.0.1', () =>
      process.send({ kind: 'listening', url: 'http://127.0.0.1:' + server.address().port }),
    );
  } catch {
    process.send({ kind: 'failed' });
    shutdown();
  }
});
process.send({ kind: 'ready' });
