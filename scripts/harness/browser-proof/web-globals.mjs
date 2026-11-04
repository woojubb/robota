/**
 * The globals of the web-only realm: what a page or a Web Worker has and Node's own globals are not
 * part of. Anything not named here is a `ReferenceError` to the code under proof — `process`,
 * `require`, `Buffer`, `global`, `setImmediate`, `__dirname` among them — and the error names it.
 *
 * Every name below is a web standard that a browser and a Worker both define. A name is added only
 * when a bundle under proof reads it, and with the reason; this is not a place to make a scenario
 * pass.
 */

/** [name, why a library under proof reads it]. The host's own value is shared, so its classes are the page's. */
export const WEB_GLOBALS = [
  ['crypto', 'Web Crypto: random ids, digests'],
  ['TextEncoder', 'UTF-8 encoding'],
  ['TextDecoder', 'UTF-8 decoding'],
  ['URL', 'address parsing'],
  ['URLSearchParams', 'query strings'],
  ['AbortController', 'cancellation'],
  ['AbortSignal', 'the signal an AbortController hands out'],
  ['ReadableStream', 'response bodies and streamed output'],
  ['TransformStream', 'stream pipelines'],
  ['WritableStream', 'the other end of a stream pipeline'],
  ['Headers', 'what fetch takes and returns'],
  ['Request', 'what fetch takes'],
  ['Response', 'what fetch returns'],
  ['FormData', 'multipart bodies; an SDK tests a body against it'],
  ['Blob', 'binary bodies; an SDK tests a body against it'],
  ['DOMException', 'the error an aborted fetch rejects with'],
  ['queueMicrotask', 'microtask scheduling'],
  ['structuredClone', 'deep copies'],
  ['btoa', 'base64 encoding'],
  ['atob', 'base64 decoding'],
];

/** Timers a browser returns numbers for, so code that treats the handle as a Node `Timeout` fails here. */
const TIMER_NAMES = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];

/** Console methods a page has; each is captured rather than printed. */
const CONSOLE_METHODS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'dir',
  'table',
  'group',
  'groupCollapsed',
  'groupEnd',
  'time',
  'timeEnd',
  'timeLog',
  'count',
  'countReset',
  'assert',
  'clear',
];

/** Every name the realm defines beyond the language's own, for the report and for tests. */
export const REALM_GLOBAL_NAMES = [
  ...WEB_GLOBALS.map(([name]) => name),
  ...TIMER_NAMES,
  'console',
  'fetch',
];

/** Globals of a Node host the realm must not have. */
export const NODE_ONLY_GLOBAL_NAMES = [
  'process',
  'Buffer',
  'global',
  'setImmediate',
  'clearImmediate',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
];

/**
 * The sandbox object a `vm` context takes its globals from, and what it collected: the console
 * output, and the timers still pending (cleared by `dispose`, so a scenario that leaves one running
 * cannot hold the process open).
 */
export function createRealmGlobals(host = globalThis) {
  const logs = [];
  const timers = new Map();
  let nextHandle = 1;
  const schedule =
    (start, stop) =>
    (callback, delay, ...args) => {
      const handle = nextHandle++;
      timers.set(
        handle,
        start(() => {
          if (stop === clearTimeout) timers.delete(handle);
          callback(...args);
        }, delay),
      );
      return handle;
    };
  const cancel = (stop) => (handle) => {
    stop(timers.get(handle));
    timers.delete(handle);
  };

  const sandbox = Object.fromEntries(WEB_GLOBALS.map(([name]) => [name, host[name]]));
  Object.assign(sandbox, {
    setTimeout: schedule(setTimeout, clearTimeout),
    clearTimeout: cancel(clearTimeout),
    setInterval: schedule(setInterval, clearInterval),
    clearInterval: cancel(clearInterval),
    console: Object.fromEntries(
      CONSOLE_METHODS.map((level) => [
        level,
        (...args) => logs.push({ level, text: args.map((value) => String(value)).join(' ') }),
      ]),
    ),
  });
  return {
    sandbox,
    logs,
    dispose() {
      for (const handle of timers.values()) {
        clearTimeout(handle);
        clearInterval(handle);
      }
      timers.clear();
    },
  };
}
