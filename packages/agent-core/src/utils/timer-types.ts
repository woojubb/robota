/**
 * Cross-platform timer identifier type.
 * Works in both Node.js and browser environments.
 *
 * Extracted to a leaf module so `periodic-task.ts` can depend on it without importing the
 * `./index` barrel (avoids a module-level import cycle).
 */
export type TTimerId = ReturnType<typeof setTimeout>;
