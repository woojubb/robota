import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock RemoteServer before importing the module under test
const mockGetExpressRouter = vi.fn(() => (_req: unknown, _res: unknown, next: unknown) => {
  if (typeof next === 'function') next();
});
const mockGetStatus = vi.fn(() => ({ ready: true }));
const mockInitialize = vi.fn(() => Promise.resolve());

vi.mock('@robota-sdk/agent-remote/server', () => ({
  RemoteServer: vi.fn(() => ({
    getExpressRouter: mockGetExpressRouter,
    getStatus: mockGetStatus,
    initialize: mockInitialize,
  })),
}));

vi.mock('swagger-ui-express', () => ({
  default: {
    serve: [
      (_req: unknown, _res: unknown, next: unknown) => {
        if (typeof next === 'function') next();
      },
    ],
    setup: () => (_req: unknown, _res: unknown, next: unknown) => {
      if (typeof next === 'function') next();
    },
  },
}));

import { registerRemoteServerRoutes, type IRemoteServerLogger } from './remote-server-routes.js';
import { RemoteServer } from '@robota-sdk/agent-remote/server';

function createMockLogger(): IRemoteServerLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

function createMockApp(): {
  use: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  return {
    use: vi.fn(),
    get: vi.fn(),
  };
}

describe('registerRemoteServerRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates RemoteServer with CORS and Helmet disabled', () => {
    const app = createMockApp();
    const logger = createMockLogger();
    registerRemoteServerRoutes({
      app: app as never,
      providers: {},
      logger,
    });
    expect(RemoteServer).toHaveBeenCalledWith({
      enableCors: false,
      enableHelmet: false,
      logger,
    });
  });

  it('initializes RemoteServer with provided providers', () => {
    const app = createMockApp();
    const logger = createMockLogger();
    const providers = { openai: {} as never };
    registerRemoteServerRoutes({
      app: app as never,
      providers,
      logger,
    });
    expect(mockInitialize).toHaveBeenCalledWith(providers);
  });

  it('mounts router at default basePath /api/v1/remote', () => {
    const app = createMockApp();
    const logger = createMockLogger();
    registerRemoteServerRoutes({
      app: app as never,
      providers: {},
      logger,
    });
    expect(app.use).toHaveBeenCalledWith('/api/v1/remote', expect.any(Function));
  });

  it('mounts router at custom basePath', () => {
    const app = createMockApp();
    const logger = createMockLogger();
    registerRemoteServerRoutes({
      app: app as never,
      providers: {},
      basePath: '/custom/path',
      logger,
    });
    expect(app.use).toHaveBeenCalledWith('/custom/path', expect.any(Function));
  });

  it('mounts API docs routes by default', () => {
    const app = createMockApp();
    const logger = createMockLogger();
    registerRemoteServerRoutes({
      app: app as never,
      providers: {},
      logger,
    });
    expect(app.get).toHaveBeenCalledWith('/docs/remote.json', expect.any(Function));
    expect(app.use).toHaveBeenCalledWith('/docs/remote', expect.any(Array), expect.any(Function));
  });

  it('skips API docs routes when apiDocsEnabled is false', () => {
    const app = createMockApp();
    const logger = createMockLogger();
    registerRemoteServerRoutes({
      app: app as never,
      providers: {},
      apiDocsEnabled: false,
      logger,
    });
    expect(app.get).not.toHaveBeenCalled();
    // app.use called only once for the router mount
    expect(app.use).toHaveBeenCalledTimes(1);
  });

  it('returns runtime with getStatus delegating to RemoteServer', () => {
    const app = createMockApp();
    const logger = createMockLogger();
    const runtime = registerRemoteServerRoutes({
      app: app as never,
      providers: {},
      logger,
    });
    const status = runtime.getStatus();
    expect(mockGetStatus).toHaveBeenCalled();
    expect(status).toEqual({ ready: true });
  });

  it('logs error when initialization fails', async () => {
    const initError = new Error('init failed');
    mockInitialize.mockReturnValueOnce(Promise.reject(initError));

    const app = createMockApp();
    const logger = createMockLogger();
    registerRemoteServerRoutes({
      app: app as never,
      providers: {},
      logger,
    });
    // Wait for the promise rejection handler
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(logger.error).toHaveBeenCalledWith('Failed to initialize remote server', initError);
  });
});
