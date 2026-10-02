import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getSharp, imageOptimizer } = require('next/dist/server/image-optimizer');
const { defaultConfig } = require('next/dist/server/config-shared');
const sharp = getSharp(1);
const pixel = { create: { width: 1, height: 1, channels: 3, background: '#226699' } };
const png = await sharp(pixel).png().toBuffer();
const avif = await sharp(pixel).avif().toBuffer();

function optimize(buffer, contentType) {
  // Exercise the installed server implementation without loading app configuration, dotenv,
  // operator state, remote images or an exploit payload. Both fixtures are benign valid pixels.
  return imageOptimizer(
    { buffer, contentType, cacheControl: null, etag: null },
    { href: '/fixture', width: 1, quality: 75, mimeType: 'image/png' },
    defaultConfig,
    { silent: true },
  );
}

async function safeAvif(contentType) {
  const result = await optimize(avif, contentType);
  // The security patch bypasses AVIF optimization and returns the original encoded bytes.
  // https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4
  assert.equal(result.contentType, 'image/avif');
  assert.deepEqual(result.buffer, avif);
}

test('the installed image optimizer serves AVIF unchanged instead of decoding it', async () => {
  await safeAvif('image/avif');
});

test('a false PNG content type cannot bypass AVIF optimization protection', async () => {
  await safeAvif('image/png');
});

test('a benign PNG still completes actual image optimization', async () => {
  const result = await optimize(png, 'image/png');
  assert.equal(result.contentType, 'image/png');
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1);
  assert.equal(metadata.height, 1);
});
