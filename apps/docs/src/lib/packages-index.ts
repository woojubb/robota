import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface IPackageIndexEntry {
  /** Directory name under packages/ — also the route segment. */
  dir: string;
  /** npm name from package.json, or the directory name when there is none. */
  name: string;
  /** First paragraph of docs/README.md, as plain text. */
  summary: string;
  /** `private: true` in package.json — not published to npm. */
  internal: boolean;
}

const MAX_SUMMARY = 240;

/** Every package that has a docs/README.md, sorted by directory name. */
export function buildPackageIndex(packagesDir: string): IPackageIndexEntry[] {
  if (!fs.existsSync(packagesDir)) return [];
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(packagesDir, e.name, 'docs', 'README.md')))
    .map((e) => e.name)
    .sort()
    .map((dir) => {
      const manifestPath = path.join(packagesDir, dir, 'package.json');
      const manifest = fs.existsSync(manifestPath)
        ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { name?: string; private?: boolean })
        : {};
      const readme = fs.readFileSync(path.join(packagesDir, dir, 'docs', 'README.md'), 'utf8');
      return {
        dir,
        name: manifest.name ?? dir,
        summary: firstParagraph(matter(readme).content),
        internal: manifest.private === true,
      };
    });
}

/** The first prose paragraph after the H1, with Markdown links and emphasis reduced to text. */
export function firstParagraph(markdown: string): string {
  const blocks = markdown.split(/\n\s*\n/).map((b) => b.trim());
  const prose = blocks.find((b) => b !== '' && !/^(#|```|[-*+] |\d+\. |\||>|<)/.test(b));
  if (!prose) return '';
  const text = prose
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : text;
}
