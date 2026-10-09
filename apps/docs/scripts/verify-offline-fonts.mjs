import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const docsDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const googleResponses = fileURLToPath(
  new URL('./empty-google-font-responses.cjs', import.meta.url),
);
const nextCli = require.resolve('next/dist/bin/next');

for (const directory of ['.next', 'out']) {
  rmSync(path.join(docsDirectory, directory), { recursive: true, force: true });
}

const build = spawnSync(process.execPath, [nextCli, 'build'], {
  cwd: docsDirectory,
  env: {
    ...process.env,
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: googleResponses,
    NEXT_TELEMETRY_DISABLED: '1',
  },
  stdio: 'inherit',
});

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const outputDirectory = path.join(docsDirectory, 'out', '_next', 'static');
const css = readdirSync(path.join(outputDirectory, 'css'))
  .filter((file) => file.endsWith('.css'))
  .map((file) => readFileSync(path.join(outputDirectory, 'css', file), 'utf8'))
  .join('\n');
const faces = [...css.matchAll(/@font-face\{([^}]+)\}/gu)].map((match) => match[1]);

for (const { family, variable, weights } of [
  { family: 'ibm-plex-mono', variable: '--font-mono-display', weights: [400, 500, 600, 700] },
  { family: 'ibm-plex-sans', variable: '--font-sans', weights: [300, 400, 500, 600] },
  { family: 'jetbrains-mono', variable: '--font-code', weights: [400, 500] },
]) {
  const cssFamily = css.match(new RegExp(`${variable}:"([^"]+)"`, 'u'))?.[1];
  assert.ok(cssFamily, `Missing ${variable} in compiled CSS`);
  const familyFaces = faces.filter((face) => face.includes(`font-family:${cssFamily};`));
  assert.equal(familyFaces.length, weights.length, `Unexpected ${family} faces`);

  for (const weight of weights) {
    const face = familyFaces.find((value) => value.includes(`font-weight:${weight};`));
    assert.ok(face, `Missing ${family} weight ${weight}`);
    assert.ok(face.includes('font-display:swap;'), `Missing swap display for ${family} ${weight}`);
    assert.ok(face.includes('font-style:normal'), `Unexpected style for ${family} ${weight}`);
    const emittedFile = face.match(/src:url\(\/_next\/static\/media\/([^)]*\.woff2)\)/u)?.[1];
    assert.ok(emittedFile, `Missing emitted WOFF2 for ${family} ${weight}`);
    const source = readFileSync(
      path.join(docsDirectory, 'src', 'fonts', family, `${family}-latin-${weight}-normal.woff2`),
    );
    const emitted = readFileSync(path.join(outputDirectory, 'media', emittedFile));
    assert.ok(emitted.equals(source), `Compiled ${family} ${weight} differs from its local source`);
  }
}

console.log('Offline font compilation emitted all ten local Latin WOFF2 faces.');
