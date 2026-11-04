/**
 * Path text handled lexically, so a platform-neutral entry never needs `node:path` (ARCHITECTURE.md
 * "Runtime platforms").
 *
 * Nothing here touches a filesystem or the process directory: a relative `base` gives a relative
 * result instead of being anchored to an ambient working directory. A path's flavour is read from
 * the text itself — a drive letter followed by a separator, or a leading `\\`, is a Windows path;
 * anything else is POSIX, where `\` is an ordinary character — so a host that works with the other
 * platform's paths (a remote Windows workspace driven from a POSIX process) is handled the same as
 * its own.
 */

/** `X:\` or `X:/`: a drive and a separator, the only drive-qualified form that is absolute. */
const DRIVE_ROOT = /^([A-Za-z]:)[\\/]+/;
/** `X:` with no separator after it: relative to drive X's own current directory. */
const DRIVE_RELATIVE = /^([A-Za-z]:)(?![\\/])/;
/** `\\server\share` (either slash), the share optional while a path is still being typed. */
const UNC_ROOT = /^[\\/]{2}([^\\/]+)(?:[\\/]+([^\\/]+))?[\\/]*/;

type TPathFlavour = 'posix' | 'win32';

function flavourOf(path: string): TPathFlavour {
  return DRIVE_ROOT.test(path) || path.startsWith('\\\\') ? 'win32' : 'posix';
}

/**
 * `/…` on every platform; `X:/…` is absolute too, so a Windows argument is judged, not dropped.
 * Works on text whose separators are already `/`; see {@link isAbsolutePath} for raw text.
 */
export function isAbsolutePathLike(normalised: string): boolean {
  return normalised.startsWith('/') || /^[A-Za-z]:(?=\/|$)/.test(normalised);
}

/**
 * `\` → `/`, `.`/`..` collapsed lexically (no filesystem access, no Node builtin), a drive letter
 * lower-cased (case-insensitive filesystems). A leading `..` on an absolute path stays at the root,
 * as `path.posix.normalize` does; on a relative path it is kept, so `../x` remains `../x`.
 */
export function normalisePathText(text: string): string {
  const slashed = text.replace(/\\/g, '/');
  const absolute = slashed.startsWith('/');
  const out: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }
  const joined = (absolute ? '/' : '') + out.join('/');
  const normalised = joined === '' ? '.' : joined;
  return normalised.replace(/^[A-Za-z]:(?=\/|$)/, (drive) => drive.toLowerCase());
}

/**
 * Whether `path` is anchored at a root on its own: POSIX `/…`, Windows `X:\…` or `X:/…`, and a UNC
 * `\\server\share`. A drive-relative `C:x` and a bare `\x` are not — each takes its drive from
 * somewhere else.
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || DRIVE_ROOT.test(path) || path.startsWith('\\\\');
}

interface IPathParts {
  /** The anchor in its final spelling: `/`, `C:\`, `\\server\share\`, a bare `\`, or nothing. */
  readonly root: string;
  readonly segments: readonly string[];
}

function splitPath(path: string, flavour: TPathFlavour): IPathParts {
  if (flavour === 'posix') {
    return {
      root: path.startsWith('/') ? '/' : '',
      segments: path.split('/').filter((segment) => segment !== '' && segment !== '.'),
    };
  }
  let root = '';
  let rest = path;
  const drive = DRIVE_ROOT.exec(path);
  const unc = drive === null ? UNC_ROOT.exec(path) : null;
  if (drive !== null) {
    root = `${drive[1]}\\`;
    rest = path.slice(drive[0].length);
  } else if (unc !== null) {
    root = unc[2] === undefined ? `\\\\${unc[1]}\\` : `\\\\${unc[1]}\\${unc[2]}\\`;
    rest = path.slice(unc[0].length);
  } else if (/^[\\/]/.test(path)) {
    root = '\\';
    rest = path.replace(/^[\\/]+/, '');
  }
  return {
    root,
    segments: rest.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.'),
  };
}

/** `..` removes the segment before it; at a root it stays at the root, on a relative path it is kept. */
function collapse(parts: IPathParts): string[] {
  const out: string[] = [];
  for (const segment of parts.segments) {
    if (segment !== '..') out.push(segment);
    else if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else if (parts.root === '') out.push('..');
  }
  return out;
}

function assemble(parts: IPathParts, flavour: TPathFlavour, trailing: boolean): string {
  const segments = collapse(parts);
  const separator = flavour === 'win32' ? '\\' : '/';
  const body = segments.join(separator);
  if (body === '') return parts.root === '' ? '.' : parts.root;
  return parts.root + body + (trailing ? separator : '');
}

/** The root of an absolute `base`, in the spelling `splitPath` gives it. */
function rootOf(base: string, flavour: TPathFlavour): string {
  return splitPath(base, flavour).root;
}

/**
 * `relative` resolved against `base`, as `path.resolve(base, relative)` on the platform `base`
 * belongs to would — but lexically, and without ever reading the process directory. An absolute
 * `relative` stands on its own. A relative `base` gives a relative result. Under a Windows base a
 * drive-relative `relative` on the base's drive (`C:x` against `C:\repo`) resolves against the base;
 * on another drive (`D:x`) it names that drive's current directory, which only a process can know,
 * so it is returned as given — still not absolute.
 */
export function resolvePath(base: string, relative: string): string {
  if (/^[A-Za-z]:[\\/]/.test(relative) || relative.startsWith('\\\\')) {
    return assemble(splitPath(relative, 'win32'), 'win32', false);
  }
  const flavour = flavourOf(base);
  if (flavour === 'posix') {
    const text = relative.startsWith('/') ? relative : `${base}/${relative}`;
    return assemble(splitPath(text, 'posix'), 'posix', false);
  }
  // `//server/share` is a UNC root under a Windows base, as `\\server\share` is.
  if (/^[\\/]{2}/.test(relative)) return assemble(splitPath(relative, 'win32'), 'win32', false);
  let anchor = base;
  let rest = relative;
  const drive = DRIVE_RELATIVE.exec(relative);
  if (drive !== null) {
    const baseDrive = DRIVE_ROOT.exec(base)?.[1];
    if (baseDrive?.toLowerCase() !== drive[1]!.toLowerCase()) return relative;
    // The drive is spelled as `relative` spells it, as `path.win32.resolve` does.
    anchor = drive[1]! + base.slice(baseDrive.length);
    rest = relative.slice(drive[0].length);
  }
  // A Windows root without a drive (`\x`, `/x`) belongs to the base's drive or share.
  const anchored = /^[\\/]/.test(rest);
  const text = anchored ? `${rootOf(anchor, 'win32')}${rest}` : `${anchor}\\${rest}`;
  return assemble(splitPath(text, 'win32'), 'win32', false);
}

/**
 * `path.join(...segments)` on the platform the first non-empty segment belongs to: joined with that
 * platform's separator, `.`/`..` collapsed, a trailing separator kept, `.` for nothing at all.
 */
export function joinPath(...segments: readonly string[]): string {
  const parts = segments.filter((segment) => segment !== '');
  if (parts.length === 0) return '.';
  const flavour = flavourOf(parts[0]!);
  const last = parts[parts.length - 1]!;
  const trailing = flavour === 'win32' ? /[\\/]$/.test(last) : last.endsWith('/');
  return assemble(
    splitPath(parts.join(flavour === 'win32' ? '\\' : '/'), flavour),
    flavour,
    trailing,
  );
}

/**
 * Whether `path` is anchored on either platform: exactly `posix.isAbsolute(path) || win32.isAbsolute(path)`.
 * Unlike {@link isAbsolutePath} it counts a bare `\x` — rooted, with its drive taken from elsewhere —
 * so a check that refuses a path escaping its root refuses that spelling on every platform.
 */
export function isRootedPath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || DRIVE_ROOT.test(path);
}

/** The separator `path` is spelled with: `\` for a Windows path (a drive or `\\` UNC root), `/` otherwise. */
export function separatorOf(absolutePath: string): '/' | '\\' {
  return flavourOf(absolutePath) === 'win32' ? '\\' : '/';
}

const SLASH = 47;
const BACKSLASH = 92;
const COLON = 58;

function isWindowsSeparator(code: number): boolean {
  return code === SLASH || code === BACKSLASH;
}

function isDriveLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function posixDirname(path: string): string {
  if (path.length === 0) return '.';
  const hasRoot = path.charCodeAt(0) === SLASH;
  let end = -1;
  let matchedSlash = true;
  for (let index = path.length - 1; index >= 1; index -= 1) {
    if (path.charCodeAt(index) === SLASH) {
      if (!matchedSlash) {
        end = index;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return path.slice(0, end);
}

/** The end of the `\\server\share` root at the start of `path`, or 0 when it is not one. */
function windowsUncRootEnd(path: string): number {
  const length = path.length;
  const skip = (from: number, separators: boolean): number => {
    let at = from;
    while (at < length && isWindowsSeparator(path.charCodeAt(at)) === separators) at += 1;
    return at;
  };
  const serverEnd = skip(2, false);
  if (serverEnd >= length || serverEnd === 2) return 0;
  const shareStart = skip(serverEnd, true);
  if (shareStart >= length || shareStart === serverEnd) return 0;
  return skip(shareStart, false);
}

function windowsDirname(path: string): string {
  const length = path.length;
  if (length === 0) return '.';
  const first = path.charCodeAt(0);
  if (length === 1) return isWindowsSeparator(first) ? path : '.';
  let rootEnd = -1;
  let offset = 0;
  if (isWindowsSeparator(first)) {
    rootEnd = offset = 1;
    if (isWindowsSeparator(path.charCodeAt(1))) {
      const uncEnd = windowsUncRootEnd(path);
      if (uncEnd === length) return path;
      if (uncEnd > 0) rootEnd = offset = uncEnd + 1;
    }
  } else if (isDriveLetter(first) && path.charCodeAt(1) === COLON) {
    rootEnd = length > 2 && isWindowsSeparator(path.charCodeAt(2)) ? 3 : 2;
    offset = rootEnd;
  }
  let end = -1;
  let matchedSlash = true;
  for (let index = length - 1; index >= offset; index -= 1) {
    if (isWindowsSeparator(path.charCodeAt(index))) {
      if (!matchedSlash) {
        end = index;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) {
    if (rootEnd === -1) return '.';
    end = rootEnd;
  }
  return path.slice(0, end);
}

/**
 * `path.dirname(path)` on the platform the path belongs to. Like the other helpers here the platform
 * is read from the text (a drive letter and separator, or a leading `\\`, means Windows), so
 * `a\b` without a drive is one POSIX name.
 */
export function dirnamePath(path: string): string {
  return flavourOf(path) === 'win32' ? windowsDirname(path) : posixDirname(path);
}

/**
 * `path.basename(path, suffix)` on the platform the path belongs to, including Node's quirk that the
 * suffix is kept when it is the whole last segment (`a/.md` with `.md` stays `.md`) yet removed when
 * it is the whole path.
 */
export function basenamePath(path: string, suffix?: string): string {
  const windows = flavourOf(path) === 'win32';
  const isSeparator = (code: number): boolean =>
    windows ? isWindowsSeparator(code) : code === SLASH;
  let start =
    windows && path.length >= 2 && isDriveLetter(path.charCodeAt(0)) && path.charCodeAt(1) === COLON
      ? 2
      : 0;
  let end = -1;
  let matchedSlash = true;
  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) return '';
    let extensionIndex = suffix.length - 1;
    let firstNonSeparatorEnd = -1;
    for (let index = path.length - 1; index >= start; index -= 1) {
      const code = path.charCodeAt(index);
      if (isSeparator(code)) {
        if (!matchedSlash) {
          start = index + 1;
          break;
        }
      } else {
        if (firstNonSeparatorEnd === -1) {
          matchedSlash = false;
          firstNonSeparatorEnd = index + 1;
        }
        if (extensionIndex >= 0) {
          if (code === suffix.charCodeAt(extensionIndex)) {
            extensionIndex -= 1;
            if (extensionIndex === -1) end = index;
          } else {
            extensionIndex = -1;
            end = firstNonSeparatorEnd;
          }
        }
      }
    }
    if (start === end) end = firstNonSeparatorEnd;
    else if (end === -1) end = path.length;
    return path.slice(start, end);
  }
  for (let index = path.length - 1; index >= start; index -= 1) {
    if (isSeparator(path.charCodeAt(index))) {
      if (!matchedSlash) {
        start = index + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = index + 1;
    }
  }
  return end === -1 ? '' : path.slice(start, end);
}

/** The parts of an absolute path with `.` and `..` collapsed, or `undefined` when it is not anchored. */
function anchoredParts(path: string, flavour: TPathFlavour): IPathParts | undefined {
  const anchored =
    flavour === 'win32'
      ? /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}/.test(path)
      : path.startsWith('/');
  if (!anchored) return undefined;
  const parts = splitPath(path, flavour);
  return { root: parts.root, segments: collapse(parts) };
}

type TRelation =
  | { readonly segments: readonly string[] }
  /** `to` is on another root or platform: it is its own relative path, normalised. */
  | { readonly elsewhere: string };

function relate(from: string, to: string): TRelation {
  const flavour = flavourOf(from);
  const origin = anchoredParts(from, flavour);
  if (origin === undefined) {
    throw new TypeError(
      `A relative path needs an absolute starting point, got ${JSON.stringify(from)}.`,
    );
  }
  const target = anchoredParts(to, flavour);
  if (target === undefined) {
    const foreign = flavour === 'posix' ? anchoredParts(to, 'win32') : undefined;
    if (foreign !== undefined) return { elsewhere: assemble(foreign, 'win32', false) };
    throw new TypeError(`A relative path needs an absolute target, got ${JSON.stringify(to)}.`);
  }
  const fold = (text: string): string => (flavour === 'win32' ? text.toLowerCase() : text);
  if (fold(origin.root) !== fold(target.root)) {
    return { elsewhere: assemble(target, flavour, false) };
  }
  let common = 0;
  while (
    common < origin.segments.length &&
    common < target.segments.length &&
    fold(origin.segments[common]!) === fold(target.segments[common]!)
  ) {
    common += 1;
  }
  return {
    segments: [...origin.segments.slice(common).map(() => '..'), ...target.segments.slice(common)],
  };
}

/**
 * The segments of `path.relative(from, to)`, or `undefined` when `to` is on another root (a Windows
 * drive or share, or another platform's spelling) and so has no path relative to `from`. A segment
 * of `..` is a step up. Both paths must be absolute; Windows names compare without regard to case,
 * as they do in `path.win32.relative`.
 *
 * Nothing is anchored to the process directory: a `from` or `to` that is relative (or a Windows path
 * that names no drive) has no answer without it and throws. Two shares of one server are two roots
 * here, where `path.win32.relative` reads `\\server\a` and `\\server\b` as sibling directories.
 */
export function relativeSegments(from: string, to: string): readonly string[] | undefined {
  const relation = relate(from, to);
  return 'segments' in relation ? relation.segments : undefined;
}

/**
 * `path.relative(from, to)` on the platform `from` belongs to, lexically: the segments of
 * {@link relativeSegments} joined with that platform's separator, or the normalised `to` itself when
 * it is on another root, as `path.win32.relative` answers across drives.
 */
export function relativePath(from: string, to: string): string {
  if (from === to) return '';
  const relation = relate(from, to);
  return 'segments' in relation ? relation.segments.join(separatorOf(from)) : relation.elsewhere;
}
