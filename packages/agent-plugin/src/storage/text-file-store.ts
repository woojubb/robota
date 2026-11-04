/**
 * The text-file persistence the `file` strategies of the history, usage and logging plugins write
 * through. The plugins are platform-neutral and own no file system: a composition root injects an
 * implementation, and `NodePluginTextFileStore` (`@robota-sdk/agent-plugin/node`) is the Node one.
 */
export interface IPluginTextFileStore {
  /** The file's text, or `undefined` when the file does not exist. */
  readText(path: string): Promise<string | undefined>;
  /** Replaces the file's text, creating the file and its missing parent directories. */
  writeText(path: string, text: string): Promise<void>;
  /** Appends to the file's text, creating the file and its missing parent directories. */
  appendText(path: string, text: string): Promise<void>;
}
