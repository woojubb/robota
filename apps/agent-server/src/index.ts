import { onRequest } from 'firebase-functions/v2/https';
import { createApp } from './app';

/**
 * Firebase Functions entry point
 * This exports the Express app as a Firebase Function
 */

// Create the Express app
const app = createApp();

// Export as Firebase Function
export const api = onRequest(
  {
    cors: false,
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
    maxInstances: 100,
  },
  app,
);

// Health check function (lightweight)
export const health = onRequest(
  {
    cors: false,
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'robota-agent-server',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'production',
    });
  },
);
