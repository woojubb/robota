import type express from 'express';
import type { IAIProvider } from '@robota-sdk/agents';
import { RemoteServer } from '@robota-sdk/remote/server';
import swaggerUi from 'swagger-ui-express';
import { REMOTE_OPENAPI_DOCUMENT } from './docs/openapi-remote.js';

const HTTP_OK = 200;

export interface IRemoteServerLogger {
    debug: (message: string, ...data: unknown[]) => void;
    info: (message: string, ...data: unknown[]) => void;
    warn: (message: string, ...data: unknown[]) => void;
    error: (message: string, ...data: unknown[]) => void;
    log: (message: string, ...data: unknown[]) => void;
}

export interface IRegisterRemoteServerRoutesOptions {
    app: express.Application;
    providers: Record<string, IAIProvider>;
    basePath?: string;
    apiDocsEnabled?: boolean;
    logger: IRemoteServerLogger;
}

export interface IRemoteServerRuntime {
    getStatus: () => unknown;
}

const DEFAULT_BASE_PATH = '/api/v1/remote';

export function registerRemoteServerRoutes(
    options: IRegisterRemoteServerRoutesOptions
): IRemoteServerRuntime {
    const remoteServer = new RemoteServer({
        enableCors: false,
        enableHelmet: false,
        logger: options.logger
    });
    remoteServer.initialize(options.providers).catch((error: unknown) => {
        options.logger.error('Failed to initialize remote server', error);
    });

    const basePath = options.basePath ?? DEFAULT_BASE_PATH;
    options.app.use(basePath, remoteServer.getExpressRouter());

    if (options.apiDocsEnabled !== false) {
        options.app.get('/docs/remote.json', (_req, res) => {
            res.status(HTTP_OK).json(REMOTE_OPENAPI_DOCUMENT);
        });
        options.app.use(
            '/docs/remote',
            swaggerUi.serve,
            swaggerUi.setup(REMOTE_OPENAPI_DOCUMENT)
        );
    }

    return {
        getStatus: () => remoteServer.getStatus()
    };
}
