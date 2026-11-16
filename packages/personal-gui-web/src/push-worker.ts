/**
 * The entry the build turns into `push-worker.js`, beside the page's index. It only hands the worker's
 * global scope to the handlers; what they do, and why the scope is the page's own path, is in the core.
 */
import { installPushWorker } from './push-worker-core.js';

import type { IWorkerScope } from './push-worker-core.js';

// The page's types describe a window; a worker's global is not one, and the core declares what it uses.
installPushWorker(self as unknown as IWorkerScope);
