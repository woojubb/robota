// Byte forwarder run inside a hosted unit: it listens on the unit's own address and pipes each
// connection to the agent's loopback ports, so a proxy outside the unit's network namespace can
// reach an agent that binds loopback only. It adds nothing to the stream and trusts nothing in it.
// Used by the image's entrypoint only when PERSONAL_AGENT_INGRESS_ADDR is set.
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORTS = [7360, 7361];

/**
 * Listens on `listenHost` for each port and pipes to the same port on `targetHost`. A port can also
 * be given as `{ listen, target }` when the two differ.
 */
export function startForwarder({ listenHost, targetHost = '127.0.0.1', ports = DEFAULT_PORTS }) {
  const servers = ports.map((entry) => {
    const listen = typeof entry === 'number' ? entry : entry.listen;
    const port = typeof entry === 'number' ? entry : entry.target;
    const server = net.createServer({ allowHalfOpen: true }, (client) => {
      const upstream = net.connect({ host: targetHost, port, allowHalfOpen: true });
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', close);
      // A closed client cannot read more. A closed upstream may still have bytes queued for the
      // client, so the client is ended and closed only once those are written.
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => {
        client.once('finish', () => client.destroy());
        client.end();
      });
      client.pipe(upstream);
      upstream.pipe(client);
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: listenHost, port: listen }, () => resolve(server));
    });
  });
  return Promise.all(servers).then((listening) => ({
    servers: listening,
    close: () => Promise.all(listening.map((s) => new Promise((done) => s.close(done)))),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const listenHost = process.env.PERSONAL_AGENT_INGRESS_ADDR;
  if (!listenHost) {
    process.stderr.write('PERSONAL_AGENT_INGRESS_ADDR is not set\n');
    process.exit(2);
  }
  startForwarder({ listenHost }).catch((error) => {
    process.stderr.write(`ingress forwarder: ${error.message}\n`);
    process.exit(1);
  });
}
