import { describe, expect, it } from 'vitest';

import { createSystemContextReferenceItems } from '../interactive-session-context-references.js';

const entry = (filePath: string, content: string) => ({ filePath, content, contentHash: 'unused' });

describe('createSystemContextReferenceItems', () => {
  it.each([
    ['/repo/app', '/repo/AGENTS.md', '../AGENTS.md'],
    ['/repo/app', '/home/user/.robota/ROBOTA.md', '../../home/user/.robota/ROBOTA.md'],
    ['/repo', '/repo/docs/AGENTS.md', 'docs/AGENTS.md'],
    ['C:\\repo\\app', 'C:\\repo\\AGENTS.md', '..\\AGENTS.md'],
    ['C:\\repo\\app', 'C:\\Users\\user\\ROBOTA.md', '..\\..\\Users\\user\\ROBOTA.md'],
    ['C:\\repo', 'D:\\shared\\AGENTS.md', 'D:\\shared\\AGENTS.md'],
  ])('labels a file outside the project from %j at %j as %j', (cwd, filePath, label) => {
    const [item] = createSystemContextReferenceItems([entry(filePath, 'text')], cwd);
    expect(item).toMatchObject({
      id: `system:${label}`,
      sourcePath: filePath,
      relativePath: label,
      originalReference: label,
      loadType: 'system',
    });
  });

  it('keeps an authority-scoped project path as it is', () => {
    const [item] = createSystemContextReferenceItems([entry('docs/AGENTS.md', 'text')], '/repo/app');
    expect(item).toMatchObject({ id: 'system:docs/AGENTS.md', relativePath: 'docs/AGENTS.md' });
  });

  it('counts the UTF-8 bytes of the content, not its characters', () => {
    const content = '\uFEFFa\u{1F600}€\uD800';
    const [item] = createSystemContextReferenceItems([entry('AGENTS.md', content)], '/repo');
    expect(item?.byteLength).toBe(Buffer.byteLength(content, 'utf8'));
  });
});
