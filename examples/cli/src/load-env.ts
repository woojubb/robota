import { existsSync } from 'node:fs';

// Load `.env` from the working directory when there is one. Imported first, so it runs before any
// module reads the environment.
if (existsSync('.env')) process.loadEnvFile('.env');
