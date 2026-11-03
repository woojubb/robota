/**
 * A supervised runtime reads its transport token from its inherited pipe, then goes on loading
 * modules. Prints what CommonJS resolution returns for a pnpm-linked dependency right after the
 * read, beside that dependency's real path.
 */
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

import { readSupervisedTransportToken } from '../../supervised-transport-token.js';

const requireFromCli = createRequire(new URL('../../../../package.json', import.meta.url));
// A running runtime has resolved modules before it reads the token, so the loader's realpath
// cache already holds this checkout's directories.
requireFromCli.resolve('ws');
readSupervisedTransportToken();
const resolved = requireFromCli.resolve('zod');
process.stdout.write(JSON.stringify({ resolved, realPath: realpathSync.native(resolved) }));
