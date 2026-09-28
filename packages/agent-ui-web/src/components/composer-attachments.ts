/**
 * #3282 §4d — pure logic behind the composer's attach button and drag-and-drop, kept apart from
 * `Composer.tsx` so it is testable without React or a DOM.
 *
 * The runtime resolves `@relative/path` references already (`prompt-file-reference-resolver.ts` in
 * agent-framework): inside the workspace only, 64 KiB per file, 256 KiB total per prompt, 8 references
 * per prompt, and (as of this change) refuses a binary file outright rather than mangling it. This
 * module mirrors those same limits client-side so a file the runtime would refuse is never even
 * attached: the running size and count totals, and a MIME/extension heuristic that refuses a
 * likely-binary file (images included) up front, before it ever becomes a chip. It does not (and
 * cannot) reuse the resolver's code directly: that package is Node-only, and this one ships to a plain
 * browser tab too (agent-ui-web SPEC: no dependency on agent-framework).
 */

/** Mirrors `DEFAULT_MAX_FILE_BYTES` in `packages/agent-framework/src/context/prompt-file-reference-resolver.ts`. */
export const MAX_ATTACHMENT_FILE_BYTES = 64 * 1024;
/** Mirrors `DEFAULT_MAX_TOTAL_BYTES` in the same resolver. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 256 * 1024;
/**
 * Mirrors `DEFAULT_MAX_REFERENCES` in the same resolver — not imported directly (agent-ui-web has no
 * dependency on agent-framework; see the module comment above), so this is a named constant kept in
 * sync by hand. The runtime counts every `@`-reference in the final prompt, including one a person
 * typed by hand, so a batch that fits under this count can still be refused server-side if the typed
 * text already carries references of its own — this client-side count only catches the common case
 * (the chips alone) before the round trip.
 */
export const MAX_ATTACHMENT_COUNT = 8;

/** Shown whenever a file cannot be resolved to a path inside the workspace — rule 3 (#3282 §4). */
export const ATTACHMENT_NO_PATH_NOTICE = 'Only files inside this project folder can be attached.';

/** Shown once the running count of attachments would pass `MAX_ATTACHMENT_COUNT`. */
export const ATTACHMENT_COUNT_LIMIT_NOTICE = `You can attach up to ${MAX_ATTACHMENT_COUNT} files to one message.`;

/**
 * Shown whenever a file looks binary (images included) — refused outright, never attached. Images are
 * not sent as native content in this version (the wire and the interactive-session runtime do not
 * carry `parts` from a submitted prompt yet), and the `@`-reference resolver has no way to carry
 * binary bytes as text either, so there is no path that would work today.
 */
export const ATTACHMENT_NON_TEXT_NOTICE = "Images and other non-text files can't be attached yet.";

/** One file the composer has turned into an `@`-reference chip, kept in the draft until sent or removed. */
export interface IDraftAttachment {
  readonly id: string;
  readonly name: string;
  /** Workspace-relative, forward-slash separated — what `@` names once inserted into the prompt. */
  readonly relativePath: string;
  readonly size: number;
}

/**
 * One file the desktop host's native "Attach files" dialog returned (#3282 §4d). Kept in structural
 * sync with `IPickedFile` in `apps/agent-gui-web/src/gui-host.ts` and
 * `apps/agent-app/electron/sidecar.ts` — the three are not imported across the Electron/browser/
 * presentation package boundaries, same as this codebase already does for the trust question.
 */
export interface IPickedFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
}

/** A file offered to the composer, from a drop, the plain HTML picker, or the desktop dialog. */
export interface ICandidateFile {
  readonly name: string;
  readonly size: number;
  readonly mimeType?: string;
  /** The real filesystem path, when the host could resolve one (desktop only). */
  readonly absolutePath?: string;
}

export type TAttachOutcome =
  | { readonly kind: 'attached'; readonly attachment: IDraftAttachment }
  | { readonly kind: 'rejected'; readonly message: string };

function normalizeSeparators(path: string): string {
  return path.replaceAll('\\', '/');
}

/**
 * Collapses `.` and `..` segments the way a filesystem path would, without touching disk — this
 * module ships to a plain browser tab too, so it cannot use `node:path`. Applied to both sides before
 * `relativeWorkspacePath` compares them, so a non-canonical path (one carrying `./`/`../` noise, e.g.
 * from a symlink or an odd OS report) is judged by what it actually resolves to, not by a raw string
 * prefix match that a `..` segment could otherwise defeat (a target that merely *starts with* the
 * root string, `../` and all, must not be treated as inside it just because the raw text lines up).
 */
function normalizePathSegments(path: string): string {
  const isRooted = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isRooted) out.push('..');
      // A rooted path cannot go above its own root — drop silently, matching path.normalize.
      continue;
    }
    out.push(segment);
  }
  return (isRooted ? '/' : '') + out.join('/');
}

/**
 * The file's path relative to the workspace root, or `null` when it is not inside it (an absolute
 * root is required; a relative/empty `workspacePath` never counts as "inside" anything). Both sides
 * are canonicalized first (see `normalizePathSegments`), then compared exactly (case-sensitive): on a
 * case-insensitive filesystem a differently-cased root is treated as outside rather than guessed at —
 * the composer would rather show the plain notice than attach the wrong file.
 */
export function relativeWorkspacePath(
  workspacePath: string | undefined,
  absolutePath: string,
): string | null {
  if (!workspacePath) return null;
  const root = normalizePathSegments(normalizeSeparators(workspacePath));
  if (!root || root === '/') return null;
  const target = normalizePathSegments(normalizeSeparators(absolutePath));
  if (target === root) return null; // the root itself is a directory, not an attachable file
  const prefix = `${root}/`;
  if (!target.startsWith(prefix)) return null;
  const relative = target.slice(prefix.length);
  return relative ? relative : null;
}

/** A MIME type the browser reports for genuinely text-ish content — never refused as binary. */
const TEXTY_MIME_TYPES = /^text\/|(?:\+|\/)(?:json|xml)$/u;
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'heic',
  'pdf', 'zip', 'tar', 'gz', 'tgz', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'wasm',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'mov', 'avi', 'wav', 'ogg', 'flac', 'm4a',
]);

/**
 * Whether the file looks binary (never sniffs bytes — MIME/extension only). When the browser reports
 * a MIME type (a drop, or the plain HTML picker), ANY non-text type refuses it — images, PDFs,
 * archives, and anything else a browser did not call `text/…`/JSON/XML. The desktop dialog gives no
 * MIME type at all, so a picked file falls back to the extension denylist.
 */
export function looksBinary(name: string, mimeType: string | undefined): boolean {
  if (mimeType) return !TEXTY_MIME_TYPES.test(mimeType);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** The same terminator set `prompt-file-reference-parser.ts` stops an `@`-reference token at. */
const UNSAFE_REFERENCE_CHARS = /[\s)\]}>,;"'`]/u;
/**
 * `prompt-file-reference-parser.ts`'s `stripTrailingPunctuation` also trims a trailing `.,:;!?` off
 * every captured `@token` — `,`/`;` are already covered above (they can appear anywhere in that
 * set), but a path merely *ending* in `.`/`:`/`!`/`?` (fine mid-string — most files have a `.`) would
 * otherwise be silently truncated by the runtime, so the chip would name a file the reference can
 * never actually resolve.
 */
const UNSAFE_TRAILING_CHAR = /[.,:;!?]$/u;

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}

function randomId(): string {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Decide what a candidate file becomes: a chip, or a plain rejection message. `existingTotalBytes` is
 * the sum of what is already attached and `existingCount` is how many chips there already are, so the
 * running 256 KiB total and the 8-file count are both enforced before the file is added rather than
 * after. The count is checked first, matching the runtime's own `checkReferenceBudget` (which also
 * checks its reference-count limit before it ever looks at the path) — once the cap is reached, every
 * further file gets the same one clear reason rather than a mix of different messages depending on
 * which check happens to run first for each one.
 */
export function evaluateCandidateFile(
  file: ICandidateFile,
  workspacePath: string | undefined,
  existingTotalBytes: number,
  existingCount: number,
): TAttachOutcome {
  if (existingCount >= MAX_ATTACHMENT_COUNT) {
    return { kind: 'rejected', message: ATTACHMENT_COUNT_LIMIT_NOTICE };
  }
  if (!file.absolutePath) return { kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE };
  const relativePath = relativeWorkspacePath(workspacePath, file.absolutePath);
  if (relativePath === null) return { kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE };
  if (UNSAFE_REFERENCE_CHARS.test(relativePath) || UNSAFE_TRAILING_CHAR.test(relativePath)) {
    return {
      kind: 'rejected',
      message: `"${file.name}" has a character (such as a space, or a period/punctuation mark at the end) the @file syntax can't carry — rename it to attach it.`,
    };
  }
  // Refused outright, never mangled: the runtime's own @-reference resolver now refuses a binary
  // file the same way (a NUL byte in the first 8 KiB) — this just says so before the round trip.
  if (looksBinary(file.name, file.mimeType)) {
    return { kind: 'rejected', message: ATTACHMENT_NON_TEXT_NOTICE };
  }
  if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
    return {
      kind: 'rejected',
      message: `${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_FILE_BYTES)} and cannot be attached.`,
    };
  }
  if (existingTotalBytes + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
    return {
      kind: 'rejected',
      message: `Attachments cannot total more than ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}.`,
    };
  }
  return {
    kind: 'attached',
    attachment: { id: randomId(), name: file.name, relativePath, size: file.size },
  };
}

/**
 * Inserts each chip as the runtime's existing `@relative/path` reference syntax — rule 2 (#3282 §4).
 * Always prefixed with `./`: the parser's `isPathLikeReference` only treats a token as a file
 * reference when it has a `.` somewhere or an explicit relative-path prefix, so a dotless name like
 * `Makefile`, `Dockerfile` or `LICENSE` — common, useful, and never refused for lacking one — would
 * otherwise be sent as plain text with no file and no diagnostic (follow-up to #3282 §4d). `./` makes
 * every path path-like regardless of its name, and the resolver collapses it back to the plain
 * relative path before use.
 */
export function buildPromptWithAttachments(
  prompt: string,
  attachments: readonly IDraftAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const refs = attachments.map((attachment) => `@./${attachment.relativePath}`).join(' ');
  return prompt ? `${prompt}\n\n${refs}` : refs;
}
