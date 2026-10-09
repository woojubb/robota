import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import { commandEnvironment } from '../command-environment.js';
import { createDefaultTransportRegistry } from '../runtime-plumbing.js';

afterEach(cleanupTestProductRuntimes);

describe('runtime admission credentials in command snapshots', () => {
  it('retains the WebSocket token for a custom product while denying its snapshot to commands', () => {
    const runtime = createTestProductRuntime('cedar', {
      PRODUCT_WS_TOKEN: 'synthetic-ws-token-3452',
      CEDAR_WS_TOKEN: 'synthetic-ws-token-3452',
      UNRELATED_VARIABLE: 'kept',
    });
    const { wsTransport } = createDefaultTransportRegistry(runtime);
    expect(wsTransport.resolvedToken).toBe('synthetic-ws-token-3452');
    expect(runtime.environment.PRODUCT_WS_TOKEN).toBe('synthetic-ws-token-3452');
    const environment = commandEnvironment(runtime.environment);
    expect(environment).not.toHaveProperty('PRODUCT_WS_TOKEN');
    expect(environment).not.toHaveProperty('CEDAR_WS_TOKEN');
    expect(environment.UNRELATED_VARIABLE).toBe('kept');
  });
});
