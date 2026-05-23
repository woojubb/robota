export interface TocEntry {
  id: string;
  text: string;
  level: number; // 2 or 3
}

/** Generate a slug ID identical to rehype-slug behaviour. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove non-word chars except hyphens
    .replace(/\s+/g, '-') // spaces → hyphens
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-|-$/g, ''); // trim leading/trailing hyphens
}

/** Parse markdown source and return ## / ### headings as ToC entries. */
export function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  // Match lines starting with ## or ### (not inside code fences)
  const lines = markdown.split('\n');
  let inCodeFence = false;

  for (const line of lines) {
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const text = h2[1].trim().replace(/`([^`]+)`/g, '$1'); // strip inline code backticks for display
      entries.push({ id: slugify(text), text, level: 2 });
      continue;
    }

    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      const text = h3[1].trim().replace(/`([^`]+)`/g, '$1');
      entries.push({ id: slugify(text), text, level: 3 });
    }
  }

  return entries;
}
