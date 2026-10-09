import { app } from 'electron';

import { startDesktop } from './main.js';

void startDesktop('cedar').catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
