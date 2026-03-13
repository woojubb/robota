import dotenv from 'dotenv';
import path from 'node:path';
import { createApp, setPlaygroundWebSocketServer } from './app';
import { PlaygroundWebSocketServer } from './websocket-server';
import { createServer } from 'http';

// Load environment variables
dotenv.config({
    path: path.resolve(process.cwd(), '.env')
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
        const wsServer = new PlaygroundWebSocketServer(server);
        setPlaygroundWebSocketServer(wsServer);

        // Start server
        server.listen(port, () => {
            console.log(`🚀 Robota API Server started on port ${port}`);
            console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔗 Server URL: http://localhost:${port}`);
            console.log(`💚 Health Check: http://localhost:${port}/health`);
            console.log(`🤖 API Docs: http://localhost:${port}/v1/remote`);
            console.log(`🔌 WebSocket: ws://localhost:${port}/ws/playground`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM received, shutting down gracefully');
            process.exit(0);
        });

        process.on('SIGINT', () => {
            console.log('SIGINT received, shutting down gracefully');
            process.exit(0);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start server if this file is run directly
if (require.main === module) {
    startServer();
}

export { startServer }; 