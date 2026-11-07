/**
 * The listener scan: every place in product code that can open a listener, found by syntax.
 *
 * A listener a same-user program can reach is a secure-mode decision, so the scan has to see every
 * way product code opens one: a `listen(`, `createServer(` or `createSocket(` call, a WebSocket
 * server, `Bun.serve`/`Bun.listen`/`Bun.udpSocket`, a Windows named pipe created by name, a UDP
 * socket's `.bind(`, and a dependency that opens sockets of its own. Those dependencies are loaded by
 * a string at runtime rather than by an import statement, so the scan matches the module name as a
 * string literal anywhere in code. It parses with TypeScript, so a comment or a sentence in a
 * message never matches, and `.bind(` counts only in a file that loads `dgram`, since everywhere
 * else it is `Function.prototype.bind`.
 *
 * Product code is the CLI, desktop app, and their local product packages. SDK packages are consumed
 * as published artifacts, so their unrelated development sources are outside this scan.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

const SCANNED_ROOTS = [
  'packages/agent-cli', 'packages/agent-gui-web', 'packages/agent-local-host',
  'packages/agent-organization-host', 'packages/agent-provider-replay', 'apps/agent-app',
] as const;

/** Directory names that never hold code a product process runs, wherever they appear. */
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '__tests__',
  '__mocks__',
  '__fixtures__',
  'fixtures',
  'testing',
  'examples',
  'scripts',
  'e2e',
]);

const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx)$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.(?:test|spec|bintest|ptytest)\.[cm]?[jt]sx?$/;

const LISTENER_CALLS = new Set(['listen', 'createServer', 'createSecureServer', 'createSocket']);
const BUN_LISTENERS = new Set(['serve', 'listen', 'udpSocket']);
/** Modules that open sockets of their own; `dgram` also makes `.bind(` a socket bind. */
const LISTENER_MODULES = new Set([
  'dgram',
  'node:dgram',
  'multicast-dns',
  'bittorrent-dht',
  'node-datachannel',
]);
const DGRAM_MODULES = new Set(['dgram', 'node:dgram']);
/** Windows named-pipe servers created through FFI by their function name. */
const NAMED_PIPE_SERVERS = new Set(['CreateNamedPipeW', 'CreateNamedPipeA']);

/** A cheap first pass: a file that holds none of these words cannot hold a hit or a gate. */
const MAY_MATCH =
  /listen|createServer|createSecureServer|createSocket|WebSocketServer|WebSocket\.Server|Bun\.|dgram|multicast-dns|bittorrent-dht|node-datachannel|CreateNamedPipe|startListener/;

export interface IListenerHit {
  readonly line: number;
  readonly match: string;
}

/** A `startListener` call; `surface` is the row it names, or `undefined` when it names none literally. */
export interface IGateCall {
  readonly line: number;
  readonly surface: string | undefined;
}

/** Whether `path` (relative to the repository root, `/`-separated) is product code the scan covers. */
export function isProductSource(path: string): boolean {
  if (!SCANNED_ROOTS.some((root) => path.startsWith(`${root}/`))) return false;
  const segments = path.split('/');
  const name = segments[segments.length - 1] ?? '';
  if (segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;
  return SOURCE_FILE.test(name) && !DECLARATION_FILE.test(name) && !TEST_FILE.test(name);
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  return /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function visit(node: ts.Node, each: (node: ts.Node) => void): void {
  each(node);
  ts.forEachChild(node, (child) => visit(child, each));
}

/** The name a call or construction is made through: `f` in `f(…)`, `x.f(…)` or `new x.f(…)`. */
function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function isBunListener(expression: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Bun' &&
    BUN_LISTENERS.has(expression.name.text)
  );
}

function isWebSocketServer(expression: ts.Expression): boolean {
  if (calleeName(expression) === 'WebSocketServer') return true;
  // `new WebSocket.Server(…)`, the `ws` package's other spelling.
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'Server' &&
    ts.isIdentifier(expression.expression) &&
    ['WebSocket', 'ws'].includes(expression.expression.text)
  );
}

function stringValue(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

/** Every place in one source file that can open a listener. */
export function listenerHits(fileName: string, text: string): IListenerHit[] {
  if (!MAY_MATCH.test(text)) return [];
  const source = parse(fileName, text);
  const hits: IListenerHit[] = [];
  const binds: IListenerHit[] = [];
  let loadsDgram = false;
  visit(source, (node) => {
    const value = stringValue(node);
    if (value !== undefined) {
      if (DGRAM_MODULES.has(value)) loadsDgram = true;
      if (LISTENER_MODULES.has(value) || NAMED_PIPE_SERVERS.has(value)) {
        hits.push({ line: lineOf(source, node), match: `'${value}'` });
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (isBunListener(node.expression)) {
        hits.push({ line: lineOf(source, node), match: `Bun.${name ?? ''}(` });
      } else if (name !== undefined && LISTENER_CALLS.has(name)) {
        hits.push({ line: lineOf(source, node), match: `${name}(` });
      } else if (name === 'bind' && ts.isPropertyAccessExpression(node.expression)) {
        binds.push({ line: lineOf(source, node), match: '.bind(' });
      }
      return;
    }
    if (ts.isNewExpression(node) && isWebSocketServer(node.expression)) {
      hits.push({ line: lineOf(source, node), match: `new ${node.expression.getText(source)}(` });
    }
  });
  return [...hits, ...(loadsDgram ? binds : [])].sort((a, b) => a.line - b.line);
}

/** The row a gate names: `SECURE_SURFACES['x']` or `SECURE_SURFACES.x`, and nothing computed. */
function namedRow(argument: ts.Expression | undefined): string | undefined {
  if (argument === undefined) return undefined;
  if (ts.isElementAccessExpression(argument)) {
    const key = stringValue(argument.argumentExpression);
    return calleeName(argument.expression) === 'SECURE_SURFACES' ? key : undefined;
  }
  if (
    ts.isPropertyAccessExpression(argument) &&
    calleeName(argument.expression) === 'SECURE_SURFACES'
  ) {
    return argument.name.text;
  }
  return undefined;
}

/** Every `startListener(…)` call in one source file, with the row it opens under. */
export function gateCalls(fileName: string, text: string): IGateCall[] {
  if (!text.includes('startListener')) return [];
  const source = parse(fileName, text);
  const calls: IGateCall[] = [];
  visit(source, (node) => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === 'startListener') {
      calls.push({ line: lineOf(source, node), surface: namedRow(node.arguments[0]) });
    }
  });
  return calls;
}

export interface IProductScan {
  /** Listener-opening hits, by repository-relative file. */
  readonly hits: ReadonlyMap<string, readonly IListenerHit[]>;
  /** `startListener` calls, by repository-relative file. */
  readonly gates: ReadonlyMap<string, readonly IGateCall[]>;
}

function walk(root: string, directory: string, each: (path: string) => void): void {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    // Never follow a link: in a pnpm workspace it reaches another package or the store.
    if (entry.isSymbolicLink()) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(root, path, each);
    } else if (entry.isFile() && isProductSource(path)) {
      each(path);
    }
  }
}

/** Scan every product source under `root`. */
export function scanProductSources(root: string = REPOSITORY_ROOT): IProductScan {
  const hits = new Map<string, IListenerHit[]>();
  const gates = new Map<string, IGateCall[]>();
  for (const scanned of SCANNED_ROOTS) {
    walk(root, scanned, (path) => {
      const text = readFileSync(join(root, path), 'utf8');
      const found = listenerHits(path, text);
      if (found.length > 0) hits.set(path, found);
      const calls = gateCalls(path, text);
      if (calls.length > 0) gates.set(path, calls);
    });
  }
  return { hits, gates };
}
