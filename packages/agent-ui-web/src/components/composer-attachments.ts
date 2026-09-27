/**
 * #3282 §4d — pure logic behind the composer's attach button and drag-and-drop, kept apart from
 * `Composer.tsx` so it is testable without React or a DOM.
 *
 * The runtime resolves `@relative/path` references already (`prompt-file-reference-resolver.ts` in
 * agent-framework): inside the workspace only, 64 KiB per file, 256 KiB total per prompt, and no
 * binary detection (a non-text file is decoded as UTF-8 and mangled, not refused). This module mirrors
 * those same two size limits client-side so a file that would fail is never attached in the first
 * place, and flags a likely-binary file so it is attached with a caution instead of a false promise
 * that it will read correctly. It does not (and cannot) reuse the resolver's code directly: that
 * package is Node-only, and this one ships to a plain browser tab too (agent-ui-web SPEC: no
 * dependency on agent-framework).
 */

/** Mirrors `DEFAULT_MAX_FILE_BYTES` in `packages/agent-framework/src/context/prompt-file-reference-resolver.ts`. */
export const MAX_ATTACHMENT_FILE_BYTES = 64 * 1024;
/** Mirrors `DEFAULT_MAX_TOTAL_BYTES` in the same resolver. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 256 * 1024;

/** Shown whenever a file cannot be resolved to a path inside the workspace — rule 3 (#3282 §4). */
export const ATTACHMENT_NO_PATH_NOTICE = 'Only files inside this project folder can be attached.';

/** One file the composer has turned into an `@`-reference chip, kept in the draft until sent or removed. */
export interface IDraftAttachment {
  readonly id: string;
  readonly name: string;
  /** Workspace-relative, forward-slash separated — what `@` names once inserted into the prompt. */
  readonly relativePath: string;
  readonly size: number;
  /** True when the name/type suggests non-text content the `@`-reference resolver would mangle. */
  readonly looksBinary: boolean;
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
 * The file's path relative to the workspace root, or `null` when it is not inside it (an absolute
 * root is required; a relative/empty `cwd` never counts as "inside" anything). Comparison is exact
 * (case-sensitive): on a case-insensitive filesystem a differently-cased root is treated as outside
 * rather than guessed at — the composer would rather show the plain notice than attach the wrong file.
 */
export function relativeWorkspacePath(cwd: string | undefined, absolutePath: string): string | null {
  if (!cwd) return null;
  const root = normalizeSeparators(cwd).replace(/\/+$/, '');
  if (!root) return null;
  const target = normalizeSeparators(absolutePath);
  if (target === root) return null; // the root itself is a directory, not an attachable file
  const prefix = `${root}/`;
  if (!target.startsWith(prefix)) return null;
  const relative = target.slice(prefix.length);
  return relative ? relative : null;
}

const TEXTY_MIME_TYPES = /^text\/|(?:\+|\/)(?:json|xml)$/u;
const BINARY_MIME_TYPES = /^(?:image|audio|video)\//u;
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'heic',
  'pdf', 'zip', 'tar', 'gz', 'tgz', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'wasm',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'mov', 'avi', 'wav', 'ogg', 'flac', 'm4a',
]);

/** Extension/MIME heuristic only — this module never reads file bytes (no sniffing pipeline). */
export function looksBinary(name: string, mimeType: string | undefined): boolean {
  if (mimeType) {
    if (TEXTY_MIME_TYPES.test(mimeType)) return false;
    if (BINARY_MIME_TYPES.test(mimeType) || mimeType === 'application/pdf' || mimeType === 'application/zip' || mimeType === 'application/octet-stream') {
      return true;
    }
  }
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** The same terminator set `prompt-file-reference-parser.ts` stops an `@`-reference token at. */
const UNSAFE_REFERENCE_CHARS = /[\s)\]}>,;"'`]/u;

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
 * the sum of what is already attached, so the running 256 KiB total is enforced before the file is
 * added rather than after.
 */
export function evaluateCandidateFile(
  file: ICandidateFile,
  cwd: string | undefined,
  existingTotalBytes: number,
): TAttachOutcome {
  if (!file.absolutePath) return { kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE };
  const relativePath = relativeWorkspacePath(cwd, file.absolutePath);
  if (relativePath === null) return { kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE };
  if (UNSAFE_REFERENCE_CHARS.test(relativePath)) {
    return {
      kind: 'rejected',
      message: `"${file.name}" has a character (such as a space) the @file syntax can't carry — rename it to attach it.`,
    };
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
    attachment: {
      id: randomId(),
      name: file.name,
      relativePath,
      size: file.size,
      looksBinary: looksBinary(file.name, file.mimeType),
    },
  };
}

/** One line shown once, below the chips, when any attached chip looks binary. */
export const BINARY_ATTACHMENT_NOTICE =
  'Binary files, including images, are sent as file references and may not read correctly.';

/** Inserts each chip as the runtime's existing `@relative/path` reference syntax — rule 2 (#3282 §4). */
export function buildPromptWithAttachments(
  prompt: string,
  attachments: readonly IDraftAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const refs = attachments.map((attachment) => `@${attachment.relativePath}`).join(' ');
  return prompt ? `${prompt}\n\n${refs}` : refs;
}
