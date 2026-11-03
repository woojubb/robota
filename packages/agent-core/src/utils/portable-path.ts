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
