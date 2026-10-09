import { generateLlmDocuments } from '@/lib/llms';

export const dynamic = 'force-static';

export async function GET() {
  const documents = await generateLlmDocuments();
  return new Response(documents?.index, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
