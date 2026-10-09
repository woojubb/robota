import { app } from 'electron';

import { startDesktop } from './main.js';

void startDesktop('amber').catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
