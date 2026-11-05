import { receiveForwardedEnvironment } from '../startup/forwarded-environment.js';

try {
  const environment = await receiveForwardedEnvironment(process.argv, { timeoutMs: Number(process.env.FORWARDED_TEST_TIMEOUT_MS ?? 5_000) });
  process.send?.({ result: 'accepted', environment });
} catch (error) {
  process.send?.({ result: 'refused', message: error instanceof Error ? error.message : 'failed' });
  process.exitCode = 1;
}
