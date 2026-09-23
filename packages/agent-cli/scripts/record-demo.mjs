#!/usr/bin/env node
/**
 * PM-031: record `docs/demo.gif` — the README demo — from the REAL robota binary.
 *
 * Three deterministic stages, no external binaries (no asciinema/agg/ffmpeg needed):
 *
 *  1. RECORD  — spawn the built `bin/robota.cjs` in a real pseudo-terminal (the same PTY substrate the
 *               `*.ptytest.ts` suites use), drive a scripted keystroke sequence, and capture the raw
 *               terminal bytes into an asciicast-v2 file. Model answers come from the offline
 *               `--session-log` replay provider (INFRA-017) — no network, no API key, no live provider.
 *               Tools are NOT replayed: the `Read` tool call really runs against the demo project on disk.
 *  2. RENDER  — replay the capture into a real terminal emulator (xterm.js) inside headless Chromium and
 *               screenshot one frame per meaningful output change. Frames are sampled from the recorded
 *               timeline, not from wall-clock, so the render is reproducible.
 *  3. ENCODE  — quantize the frames to a shared palette and write an animated GIF (pure JS, `gifenc`),
 *               with unchanged pixels written as transparent so a mostly-static terminal compresses hard.
 *
 * A leak scan runs over the capture before anything is written: home directory, hostname, username and
 * API-key-shaped strings fail the recording rather than reaching a published asset.
 *
 * Usage:
 *   pnpm --filter @robota-sdk/agent-cli build   # the recorder drives the BUILT binary
 *   pnpm --filter @robota-sdk/agent-cli demo:record
 *
 * Flags:
 *   --out <path>      output GIF (default: docs/demo.gif)
 *   --cast <path>     also write the raw asciicast capture here (default: none)
 *   --cols/--rows     terminal geometry (default: 90x33 — the geometry docs/demo.gif was recorded at)
 *   --font-size <px>  render font size (default: 14)
 *   --colors <n>      palette size, 2..255 (default: 128)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { GIFEncoder, applyPalette, quantize } = require('gifenc');
const { PNG } = require('pngjs');
const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const { chromium } = require('playwright');

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROBOTA_BIN = join(PKG_ROOT, 'bin/robota.cjs');
const XTERM_ROOT = dirname(require.resolve('@xterm/xterm/package.json'));

/**
 * Everything the demo run touches lives under here — never the real HOME.
 *
 * `mkdtemp`, not a fixed `/tmp/robota-demo`: a predictable path in a world-writable directory can be
 * pre-created by another user on a shared host as a symlink, so the recorder would follow it out of
 * the sandbox on the very first write (CodeQL `js/insecure-temporary-file`). `mkdtemp` creates the
 * root itself, mode 0700, under a name nobody can guess; the files inside are written 0600. The
 * random name never reaches the screen — the demo's tool call reads a project-relative path.
 */
const DEMO_ROOT = mkdtempSync(join(tmpdir(), 'robota-demo-'));
const PROJECT_DIR = join(DEMO_ROOT, 'task-board');
const HOME_DIR = join(DEMO_ROOT, 'home');
const SESSION_LOG = join(DEMO_ROOT, 'demo-session-log.jsonl');
/** Owner-only file/directory modes for everything the recorder writes into that root. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const options = parseArgs(process.argv.slice(2));

/**
 * The demo project. A real (small) codebase written to disk before the run, so the `Read` tool call in
 * the recording reads a real file and the replayed explanation describes what is actually on screen.
 */
const DEMO_PROJECT_FILES = {
  'src/index.ts': `import { createServer } from 'node:http';

import { renderBoard } from './board.js';
import { loadTasks } from './store.js';

const PORT = Number(process.env.PORT ?? 8080);

/** Boot the task board: load the tasks from disk, then serve the rendered board. */
export function main(): void {
  const tasks = loadTasks('tasks.json');
  createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(renderBoard(tasks));
  }).listen(PORT, () => console.log(\`task board on http://localhost:\${PORT}\`));
}

main();
`,
  'src/board.ts': `import type { ITask } from './store.js';

/** Render the task list as a minimal HTML board. */
export function renderBoard(tasks: readonly ITask[]): string {
  const rows = tasks.map((task) => \`<li>\${task.done ? '[x]' : '[ ]'} \${task.title}</li>\`);
  return \`<html><body><h1>Task board</h1><ul>\${rows.join('')}</ul></body></html>\`;
}
`,
  'src/store.ts': `import { readFileSync } from 'node:fs';

export interface ITask {
  title: string;
  done: boolean;
}

/** Load the task list from a JSON file, tolerating a missing file. */
export function loadTasks(path: string): ITask[] {
  return JSON.parse(readFileSync(path, 'utf8')) as ITask[];
}
`,
  'tasks.json': `[{ "title": "ship the demo", "done": false }]\n`,
  'README.md': `# task-board\n\nA tiny HTTP task board used as the robota demo project.\n`,
};

/** The prompt typed in the demo. */
const DEMO_PROMPT = 'Explain the main entry point of this project';

/**
 * Recorded provider responses replayed by `--session-log` (INFRA-017). Round 0 answers with a `Read`
 * tool call — which the CLI really executes — and round 1 explains the file that was read.
 */
function demoSessionLog() {
  // Project-relative, not absolute: the tool resolves it against the session's working directory, so
  // the throwaway `mkdtemp` name never appears on screen and the demo shows `Read(src/index.ts)`.
  const readArgs = JSON.stringify({ filePath: 'src/index.ts' });
  const answer = [
    '`src/index.ts` is the entry point — it boots a tiny task-board HTTP server:',
    '',
    '1. `loadTasks("tasks.json")` reads the task list from disk.',
    '2. `createServer` answers every request with `renderBoard(tasks)` as HTML.',
    '3. It listens on `process.env.PORT` (default `8080`) and logs the URL.',
    '',
    '`main()` runs at the bottom of the file, so the server starts on import.',
  ].join('\n');

  return [
    { event: 'provider_request', executionId: 'demo-1', round: 0 },
    {
      event: 'provider_response_normalized',
      executionId: 'demo-1',
      round: 0,
      response: {
        role: 'assistant',
        id: 'demo-assistant-1',
        timestamp: '2026-07-26T00:00:01.000Z',
        content: "Let me read the project's entry point.",
        // Issue #2302: this recorded call EXECUTES on replay (replay substitutes the model, not
        // the tools); its result reaches stdout only because the demo runs interactively, where
        // tool output is rendered — under `-p` only the final assistant text is printed.
        toolCalls: [
          { id: 'demo-call-1', type: 'function', function: { name: 'Read', arguments: readArgs } },
        ],
      },
    },
    { event: 'provider_request', executionId: 'demo-1', round: 1 },
    {
      event: 'provider_response_normalized',
      executionId: 'demo-1',
      round: 1,
      response: {
        role: 'assistant',
        id: 'demo-assistant-2',
        timestamp: '2026-07-26T00:00:02.000Z',
        content: answer,
      },
    },
  ].map((entry) => ({
    timestamp: '2026-07-26T00:00:00.000Z',
    sessionId: 'robota-demo',
    ...entry,
  }));
}

// ---------------------------------------------------------------------------------------------
// Stage 1 — record
// ---------------------------------------------------------------------------------------------

function writeDemoWorkspace() {
  // No `rmSync` first: `DEMO_ROOT` is a fresh `mkdtemp` directory, so there is nothing to clear and
  // nothing pre-existing to follow. It is removed at the end of a successful run.
  for (const [relative, contents] of Object.entries(DEMO_PROJECT_FILES)) {
    const target = join(PROJECT_DIR, relative);
    mkdirSync(dirname(target), { recursive: true, mode: DIR_MODE });
    writeFileSync(target, contents, { encoding: 'utf8', mode: FILE_MODE });
  }
  mkdirSync(HOME_DIR, { recursive: true, mode: DIR_MODE });
  mkdirSync(join(PROJECT_DIR, '.robota'), { recursive: true, mode: DIR_MODE });
  // A provider profile so the CLI boots straight into the REPL instead of the first-run wizard. The
  // key is a placeholder and is never used: `--session-log` replaces the provider with the replay one.
  writeFileSync(
    join(PROJECT_DIR, '.robota/settings.json'),
    `${JSON.stringify(
      {
        currentProvider: 'anthropic',
        providers: {
          anthropic: {
            type: 'anthropic',
            model: 'demo-replay-model',
            apiKey: 'unused-offline-replay',
          },
        },
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: FILE_MODE },
  );
  writeFileSync(
    SESSION_LOG,
    `${demoSessionLog()
      .map((line) => JSON.stringify(line))
      .join('\n')}\n`,
    { encoding: 'utf8', mode: FILE_MODE },
  );
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function stripAnsi(text) {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '') // OSC (window title etc.)
    .replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '') // CSI (colour, cursor, erase)
    .replace(/\u001B[()#][0-9A-Za-z]/g, '') // charset selection
    .replace(/[\u000E\u000F]/g, ''); // shift in/out
}

async function record() {
  if (!existsSync(ROBOTA_BIN) || !existsSync(join(PKG_ROOT, 'dist/node/bin.js'))) {
    throw new Error(
      'the built CLI is missing — run `pnpm --filter @robota-sdk/agent-cli build` before recording',
    );
  }
  writeDemoWorkspace();

  const child = pty.spawn(
    process.execPath,
    [ROBOTA_BIN, '--session-log', SESSION_LOG, '--name', 'demo'],
    {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: PROJECT_DIR,
      // Deliberately minimal: no inherited environment, so no real provider key, token or personal
      // path can reach the recording.
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: HOME_DIR, TERM: 'xterm-256color' },
    },
  );

  const events = [];
  let transcript = '';
  const startedAt = Date.now();
  child.onData((chunk) => {
    events.push([(Date.now() - startedAt) / 1000, 'o', chunk]);
    transcript += chunk;
  });

  const waitFor = async (pattern, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pattern.test(stripAnsi(transcript))) return;
      await sleep(50);
    }
    throw new Error(
      `timed out waiting for ${pattern}\n--- last output ---\n${stripAnsi(transcript).slice(-2000)}`,
    );
  };
  const typeText = async (text, perKeyMs = 42) => {
    for (const character of text) {
      child.write(character);
      await sleep(perKeyMs);
    }
  };

  try {
    await waitFor(/Type a message or \/help/);
    await sleep(1400); // hold on the welcome screen
    await typeText(DEMO_PROMPT);
    await sleep(500);
    child.write('\r');
    await waitFor(/main\(\) runs at the bottom/, 40_000);
    await sleep(3000); // hold on the answer so a looping README GIF is readable
  } finally {
    child.kill();
  }

  assertNoLeakedSecrets(transcript);

  return {
    version: 2,
    width: options.cols,
    height: options.rows,
    timestamp: 0,
    env: { TERM: 'xterm-256color', SHELL: '/bin/sh' },
    events,
  };
}

/**
 * Fail the recording — loudly — if anything personal or credential-shaped reached the terminal.
 * A published asset is the wrong place to discover a leaked path or token.
 */
function assertNoLeakedSecrets(transcript) {
  const text = stripAnsi(transcript);
  const findings = [];
  const user = process.env['USER'] ?? process.env['LOGNAME'] ?? '';
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Personal identifiers are matched in the shapes they actually leak in — a path, a `user@host`, a
  // machine name — not as bare words, so ordinary prose ("HTTP server") cannot trip the scan.
  const identifierChecks = [
    ['real home directory', new RegExp(escape(homedir()))],
    ['home-directory path', /(?:\/home|\/Users)\/[A-Za-z0-9._-]+/],
    ['tilde-expanded home path', /~\/[A-Za-z0-9._-]/],
    ...(user.length > 1
      ? [
          ['username in a path', new RegExp(`/${escape(user)}(?:/|\\b)`)],
          ['user@host', new RegExp(`\\b${escape(user)}@`)],
        ]
      : []),
    // Only the shapes a hostname actually leaks in (`user@host`, `host.local`). A bare word is not
    // checked: plenty of machines are called `server`, and the demo text says "HTTP server".
    [
      'machine hostname',
      new RegExp(
        `@${escape(hostname())}\\b|\\b${escape(hostname())}\\.(?:local|lan|internal|home)\\b`,
      ),
    ],
  ];
  for (const [label, pattern] of identifierChecks) {
    const match = pattern.exec(text);
    if (match) findings.push(`${label} in output: ${match[0]}`);
  }

  const credentialPatterns = [
    /sk-[A-Za-z0-9_-]{12,}/,
    /AIza[0-9A-Za-z_-]{20,}/,
    /gh[pousr]_[A-Za-z0-9]{16,}/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /_API_KEY\s*[=:]\s*\S+/,
  ];
  for (const pattern of credentialPatterns) {
    const match = pattern.exec(text);
    if (match) findings.push(`credential-shaped string in output: ${match[0].slice(0, 12)}…`);
  }

  if (findings.length > 0) {
    throw new Error(`refusing to publish the recording:\n  - ${findings.join('\n  - ')}`);
  }
  console.log('  leak scan: clean (no home path, hostname, username or key-shaped string)');
}

// ---------------------------------------------------------------------------------------------
// Stage 2 — render frames with xterm.js in headless Chromium
// ---------------------------------------------------------------------------------------------

/**
 * Turn the recorded event stream into frames: coalesce output into `minFrameMs` buckets, and clamp
 * idle gaps so a pause while nothing happens does not stretch the GIF.
 */
function planFrames(events, { minFrameMs = 110, maxGapMs = 900, holdMs = 3000 } = {}) {
  const buckets = [];
  let elapsed = 0;
  let previous = 0;
  for (const [at, , data] of events) {
    const gap = Math.min((at - previous) * 1000, maxGapMs);
    previous = at;
    elapsed += gap;
    const last = buckets.at(-1);
    if (last && elapsed - last.at < minFrameMs) last.data += data;
    else buckets.push({ at: elapsed, data });
  }
  return buckets.map((bucket, index) => {
    const next = buckets[index + 1];
    const delay = next ? Math.round(next.at - bucket.at) : holdMs;
    return { data: bucket.data, delay: Math.max(40, Math.min(delay, maxGapMs)) };
  });
}

const TERMINAL_THEME = {
  background: '#12131a',
  foreground: '#d5d8e2',
  cursor: '#d5d8e2',
  black: '#12131a',
  red: '#e06c75',
  green: '#8ec07c',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d5d8e2',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

async function renderFrames(cast) {
  const plan = planFrames(cast.events);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.setContent(
      `<style>${readFileSync(join(XTERM_ROOT, 'css/xterm.css'), 'utf8')}
       html,body{margin:0;background:${TERMINAL_THEME.background};}
       #shot{display:inline-block;padding:14px 16px;background:${TERMINAL_THEME.background};}
       .xterm-viewport{overflow:hidden !important;}</style>
       <div id="shot"><div id="term"></div></div>`,
    );
    await page.addScriptTag({ content: readFileSync(join(XTERM_ROOT, 'lib/xterm.js'), 'utf8') });
    await page.evaluate(
      ({ cols, rows, fontSize, theme }) => {
        const term = new window.Terminal({
          cols,
          rows,
          fontSize,
          fontFamily: '"DejaVu Sans Mono", "Liberation Mono", monospace',
          lineHeight: 1.15,
          cursorBlink: false,
          scrollback: 0,
          theme,
        });
        term.open(document.getElementById('term'));
        window.__term = term;
        window.__feed = (data) =>
          new Promise((done) => {
            term.write(data, () => requestAnimationFrame(() => requestAnimationFrame(done)));
          });
      },
      { cols: cast.width, rows: cast.height, fontSize: options.fontSize, theme: TERMINAL_THEME },
    );

    const shot = page.locator('#shot');
    const frames = [];
    for (const [index, step] of plan.entries()) {
      await page.evaluate((data) => window.__feed(data), step.data);
      frames.push({ png: await shot.screenshot({ type: 'png' }), delay: step.delay });
      if ((index + 1) % 10 === 0) console.log(`  rendered ${index + 1}/${plan.length} frames`);
    }
    return frames;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Stage 3 — encode the GIF
// ---------------------------------------------------------------------------------------------

function encodeGif(frames) {
  const decoded = frames.map(({ png, delay }) => {
    const image = PNG.sync.read(png);
    return { width: image.width, height: image.height, rgba: new Uint8Array(image.data), delay };
  });
  const { width, height } = decoded[0];
  if (decoded.some((frame) => frame.width !== width || frame.height !== height)) {
    throw new Error('frame dimensions drifted mid-render');
  }

  // One palette for the whole animation, sampled across every frame, so later frames can be written
  // as a transparent diff against what is already on screen.
  const sample = new Uint8Array(decoded.length * width * height * 4);
  decoded.forEach((frame, index) => sample.set(frame.rgba, index * width * height * 4));
  const palette = quantize(sample, options.colors, { format: 'rgb565' });
  const transparentIndex = palette.length;
  const gifPalette = [...palette, [0, 0, 0]];

  const encoder = GIFEncoder();
  let previous;
  for (const [index, frame] of decoded.entries()) {
    const current = applyPalette(frame.rgba, palette, 'rgb565');
    const indexed = Uint8Array.from(current);
    if (previous) {
      for (let pixel = 0; pixel < indexed.length; pixel++) {
        if (current[pixel] === previous[pixel]) indexed[pixel] = transparentIndex;
      }
    }
    previous = current;
    encoder.writeFrame(indexed, width, height, {
      ...(index === 0 ? { palette: gifPalette, repeat: 0 } : {}),
      delay: frame.delay,
      transparent: index > 0,
      transparentIndex,
      dispose: 1,
    });
  }
  encoder.finish();
  return { gif: Buffer.from(encoder.bytes()), width, height, frameCount: decoded.length };
}

// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = {
    out: join(PKG_ROOT, 'docs/demo.gif'),
    cast: undefined,
    cols: 90,
    rows: 33,
    fontSize: 14,
    colors: 128,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--out') parsed.out = resolve(value);
    else if (flag === '--cast') parsed.cast = resolve(value);
    else if (flag === '--cols') parsed.cols = Number(value);
    else if (flag === '--rows') parsed.rows = Number(value);
    else if (flag === '--font-size') parsed.fontSize = Number(value);
    else if (flag === '--colors') parsed.colors = Number(value);
    else throw new Error(`unknown flag: ${flag}`);
  }
  return parsed;
}

async function main() {
  console.log('1/3 recording the built CLI under a PTY (offline replay provider)…');
  const cast = await record();
  console.log(`  captured ${cast.events.length} output chunks`);
  if (options.cast) {
    const header = JSON.stringify({
      version: cast.version,
      width: cast.width,
      height: cast.height,
      timestamp: cast.timestamp,
      env: cast.env,
    });
    writeFileSync(
      options.cast,
      `${header}\n${cast.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    );
    console.log(`  asciicast written to ${options.cast}`);
  }

  console.log('2/3 rendering frames with xterm.js in headless Chromium…');
  const frames = await renderFrames(cast);

  console.log('3/3 encoding the GIF…');
  const { gif, width, height, frameCount } = encodeGif(frames);
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, gif);

  const kib = (gif.byteLength / 1024).toFixed(1);
  console.log(`\ndone: ${options.out}`);
  console.log(`  ${width}x${height}px · ${frameCount} frames · ${kib} KiB`);
  try {
    console.log(`  file(1): ${execFileSync('file', ['-b', options.out]).toString().trim()}`);
  } catch {
    // `file` is a convenience check only; its absence is not a recording failure.
  }
  if (gif.byteLength > 5 * 1024 * 1024) {
    throw new Error('the GIF exceeds the 5 MB README budget — lower --colors or shorten the demo');
  }
  rmSync(DEMO_ROOT, { recursive: true, force: true });
}

await main();
