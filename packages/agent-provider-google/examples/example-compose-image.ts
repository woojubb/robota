import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GoogleProvider } from '../src/provider';
import type { IAssistantMessage } from '@robota-sdk/agent-core';

function resolveApiKey(): string {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Set GOOGLE_API_KEY (or GOOGLE_AI_API_KEY) before running this example.');
  }
  return apiKey;
}

async function readImageAsBase64(filePath: string): Promise<string> {
  const fileBytes = await readFile(filePath);
  return fileBytes.toString('base64');
}

async function main(): Promise<void> {
  const sourceImagePath = process.env.GEMINI_SOURCE_IMAGE_PATH;
  const styleImagePath = process.env.GEMINI_STYLE_IMAGE_PATH;
  if (process.env.DRY_RUN === '1') {
    process.stdout.write('DRY_RUN enabled. compose example configuration validated.\n');
    return;
  }
  if (!sourceImagePath || !styleImagePath) {
    throw new Error(
      'Set GEMINI_SOURCE_IMAGE_PATH and GEMINI_STYLE_IMAGE_PATH before running this example.',
    );
  }

  const prompt =
    process.env.GEMINI_COMPOSE_PROMPT ??
    'Use the first image subject and render with the second image style. Keep composition natural.';
  const model = process.env.GEMINI_IMAGE_MODEL;
  if (!model) {
    throw new Error('GEMINI_IMAGE_MODEL environment variable is required');
  }

  const provider = new GoogleProvider({
    apiKey: resolveApiKey(),
    imageCapableModels: [model],
    defaultResponseModalities: ['TEXT', 'IMAGE'],
  });

  const sourceBase64 = await readImageAsBase64(sourceImagePath);
  const styleBase64 = await readImageAsBase64(styleImagePath);

  const response = await provider.chat(
    [
      {
        role: 'user',
        content: prompt,
        parts: [
          { type: 'image_inline', mimeType: 'image/png', data: sourceBase64 },
          { type: 'image_inline', mimeType: 'image/png', data: styleBase64 },
          { type: 'text', text: prompt },
        ],
        timestamp: new Date(),
      },
    ],
    {
      model,
      google: { responseModalities: ['TEXT', 'IMAGE'] },
    },
  );

  if (response.role !== 'assistant') {
    throw new Error('Expected assistant response.');
  }
  const assistantResponse = response as IAssistantMessage;
  const imagePart = assistantResponse.parts?.find((part) => part.type === 'image_inline');
  if (!imagePart || imagePart.type !== 'image_inline') {
    throw new Error('No inline image part was returned by Gemini composition call.');
  }

  const outputDir = path.resolve(process.cwd(), 'tmp');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'gemini-compose-image.png');
  await writeFile(outputPath, Buffer.from(imagePart.data, 'base64'));

  process.stdout.write(`Composed image generated: ${outputPath}\n`);
}

void main();
