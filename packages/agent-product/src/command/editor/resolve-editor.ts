/**
 * Editor-selection seam. Resolves `$VISUAL` → `$EDITOR` → `vi` (POSIX-first; a Windows
 * default is a separate concern). Splits on whitespace so `"code -w"` / `"subl -w"` style values work.
 */
export interface IResolvedEditor {
  command: string;
  args: readonly string[];
}

export function resolveEditor(): IResolvedEditor {
  const visual = process.env.VISUAL?.trim();
  const editor = process.env.EDITOR?.trim();
  const chosen =
    visual !== undefined && visual.length > 0
      ? visual
      : editor !== undefined && editor.length > 0
        ? editor
        : 'vi';
  const parts = chosen.split(/\s+/).filter((p) => p.length > 0);
  return { command: parts[0] ?? 'vi', args: parts.slice(1) };
}
