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

function assertVersionAtLeast(actual, minimum, label) {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] > minimumParts[index]) return;
    if (actualParts[index] < minimumParts[index]) {
      assert.fail(`${label} requires >= ${minimum}; found ${actual}`);
    }
  }
}

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
  // The patched optimizer either passes AVIF through or decodes it only with a libheif release
  // whose AVIF decoder contains the upstream fix. This depends on the installed Sharp binary.
  // https://github.com/advisories/GHSA-2xp9-vwfh-vxw4
  if (result.contentType === 'image/avif') {
    assert.deepEqual(result.buffer, avif);
    return;
  }

  assert.equal(result.contentType, 'image/png');
  const heif = sharp.versions.heif;
  assert.ok(heif, 'AVIF decoding requires a reported libheif version');
  const [major, minor, patch] = heif.split('.').map(Number);
  assert.ok(
    major > 1 || (major === 1 && (minor > 23 || (minor === 23 && patch >= 2))),
    `AVIF decoding requires libheif >= 1.23.2; found ${heif}`,
  );
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, 'png');
}

test('the installed image optimizer decodes AVIF only through a patched libheif', async () => {
  await safeAvif('image/avif');
});

test('a false PNG content type cannot bypass AVIF optimization protection', async () => {
  await safeAvif('image/png');
});

test('the installed optimizer carries the patched Sharp SVG boundary', () => {
  // https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw
  assertVersionAtLeast(sharp.versions.sharp, '0.35.5', 'SVG optimization');
});

test('a benign PNG still completes actual image optimization', async () => {
  const result = await optimize(png, 'image/png');
  assert.equal(result.contentType, 'image/png');
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1);
  assert.equal(metadata.height, 1);
});
