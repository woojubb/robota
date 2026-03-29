import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    date: z.string(),
    author: z.string().optional(),
    authorUrl: z.string().url().optional(),
    image: z.string().url().optional(),
    lang: z.enum(['en', 'ko']),
  }),
});

export const collections = { blog };
