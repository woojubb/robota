import { BytedanceProvider } from '../src/provider';

async function main(): Promise<void> {
  if (process.env.DRY_RUN === '1') {
    process.stdout.write('[DRY_RUN] Skipping ByteDance API request.\n');
    return;
  }

  const apiKey = process.env.BYTEDANCE_API_KEY ?? process.env.ARK_API_KEY;
  const baseUrl = process.env.BYTEDANCE_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error('BYTEDANCE_API_KEY(or ARK_API_KEY) and BYTEDANCE_BASE_URL are required.');
  }

  const provider = new BytedanceProvider({
    apiKey,
    baseUrl,
  });

  const result = await provider.createVideo({
    prompt: 'A cinematic sunset timelapse over a futuristic city skyline.',
    model: 'seedance-1-5-pro-251215',
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main();
