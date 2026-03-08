import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GoogleProvider } from '../src/provider';
import type { IAssistantMessage } from '@robota-sdk/agents';

function resolveApiKey(): string {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('Set GOOGLE_API_KEY (or GOOGLE_AI_API_KEY) before running this example.');
    }
    return apiKey;
}

async function main(): Promise<void> {
    const prompt = process.env.GEMINI_IMAGE_PROMPT
        ?? 'Create a cinematic cyberpunk cityscape at night with neon reflections.';
    const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
    if (process.env.DRY_RUN === '1') {
        process.stdout.write(`DRY_RUN enabled. model=${model}, promptLength=${prompt.length}\n`);
        return;
    }

    const provider = new GoogleProvider({
        apiKey: resolveApiKey(),
        imageCapableModels: [model],
        defaultResponseModalities: ['TEXT', 'IMAGE']
    });

    const response = await provider.chat(
        [
            {
                role: 'user',
                content: prompt,
                parts: [
                    { type: 'text', text: prompt }
                ],
                timestamp: new Date()
            }
        ],
        {
            model,
            google: { responseModalities: ['TEXT', 'IMAGE'] }
        }
    );

    if (response.role !== 'assistant') {
        throw new Error('Expected assistant response.');
    }
    const assistantResponse = response as IAssistantMessage;
    const imagePart = assistantResponse.parts?.find((part) => part.type === 'image_inline');
    if (!imagePart || imagePart.type !== 'image_inline') {
        throw new Error('No inline image part was returned by Gemini.');
    }

    const outputDir = path.resolve(process.cwd(), 'tmp');
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'gemini-generate-image.png');
    await writeFile(outputPath, Buffer.from(imagePart.data, 'base64'));

    process.stdout.write(`Image generated: ${outputPath}\n`);
}

void main();
