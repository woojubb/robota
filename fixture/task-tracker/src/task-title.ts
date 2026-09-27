export const MAX_TITLE_LENGTH = 80;

export type TitleResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

/** Validate a task title before a task is created. */
export function validateTaskTitle(input: string): TitleResult {
  if (input.length === 0) {
    return { ok: false, error: 'Title is required' };
  }
  if (input.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `Title must be at most ${MAX_TITLE_LENGTH} characters` };
  }
  return { ok: true, title: input.trim() };
}
