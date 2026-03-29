import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
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
