import { expect, it } from 'vitest';
import { decodeFrontmatterJson } from '../frontmatter-json.js';

it('preserves every field and nested JSON value for content comparison while retaining body bytes', () => {
  const decoded = decodeFrontmatterJson(
    'fixture',
    '---\r\nname: demo\r\ndescription: Use demo\r\nallowed-tools: Read\r\nfuture: {nested: [true, null, 3]}\r\nlicense: MIT\r\n---\r\nInstructions.\r\n',
  );
  expect(decoded).toEqual({
    ok: true,
    frontmatter: {
      name: 'demo',
      description: 'Use demo',
      'allowed-tools': 'Read',
      future: { nested: [true, null, 3] },
      license: 'MIT',
    },
    body: 'Instructions.\r\n',
  });
});

it('keeps prototype-named keys as inert own JSON fields', () => {
  const decoded = decodeFrontmatterJson(
    'fixture',
    '---\n__proto__: {changed: true}\nconstructor: retained\n---\nbody',
  );
  expect(decoded?.ok).toBe(true);
  if (!decoded?.ok) throw new Error('decode failed');
  expect(Object.getPrototypeOf(decoded.frontmatter)).toBe(null);
  expect(Object.hasOwn(decoded.frontmatter, '__proto__')).toBe(true);
  expect(decoded.frontmatter.constructor).toBe('retained');
  expect({}).not.toHaveProperty('changed');
});

it.each([
  'name: demo\nname: other',
  'metadata: {key: 1, key: 2}',
  'name: &anchor demo\ndescription: *anchor',
  'future: .inf',
  'future: .nan',
  '3: numeric-key',
  '[one, two]',
])('refuses ambiguous or non-JSON frontmatter: %s', (header) => {
  expect(decodeFrontmatterJson('fixture', `---\n${header}\n---\nbody`)).toMatchObject({
    ok: false,
  });
});

it('does not infer frontmatter when a document has no opening delimiter', () => {
  expect(decodeFrontmatterJson('fixture', 'plain markdown')).toBeUndefined();
});
