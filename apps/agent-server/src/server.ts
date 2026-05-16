import dotenv from 'dotenv';
import path from 'node:path';
import { createApp, setPlaygroundWebSocketServer } from './app';
import { PlaygroundWebSocketServer } from './websocket-server';
import { createServer } from 'http';
import { createLogger } from '@robota-sdk/agent-core';

// Load environment variables
dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
});

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;
const logger = createLogger('agent-server');

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', String(promise), 'reason:', reason as Error);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

/**
 * Standalone server entry point
 * This file is used when running the API server independently
 */
async function startServer() {
  try {
    // Create Express app
    const app = createApp();

    // Create HTTP server
    const port = parseInt(process.env.PORT || '3001', 10);
    const server = createServer(app);

    // Initialize WebSocket server
    const wsServer = new PlaygroundWebSocketServer(server, logger);
    setPlaygroundWebSocketServer(wsServer);

    // Start server
    server.listen(port, () => {
      logger.info(`Robota API Server started on port ${port}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Server URL: http://localhost:${port}`);
      logger.info(`Health Check: http://localhost:${port}/health`);
      logger.info(`API Docs: http://localhost:${port}/v1/remote`);
      logger.info(`WebSocket: ws://localhost:${port}/ws/playground`);
    });

    // Graceful shutdown
    const shutdown = (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully`);
      wsServer.close();
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
      // Force exit after timeout if graceful shutdown stalls
      setTimeout(() => {
        logger.warn('Graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error as Error);
    process.exit(1);
  }
}

startServer();

export { startServer };
