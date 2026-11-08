// @robota-sdk/agent-product/command/node — the commands whose whole purpose is the host (`/shell` and
// `/editor` hand the real terminal to a child process, and `createTerminalClientCommands` runs them
// on an attached terminal) and the Node adapters a command takes by injection (the doctor's probes
// and writers, the editor `/keybindings` opens). The main entry names none of them: a composition
// root that runs on Node imports them from here and passes them in.

export {
  EDITOR_COMMAND_DESCRIPTION,
  EditorCommandSource,
  createEditorCommandEntry,
  createEditorCommandModule,
  executeEditorCommand,
  openFileInEditor,
  resolveEditor,
} from './editor/index.js';
export type { IResolvedEditor } from './editor/index.js';
export {
  SHELL_COMMAND_DESCRIPTION,
  ShellCommandSource,
  createShellCommandEntry,
  createShellCommandModule,
  executeShellCommand,
  resolveShell,
  spawnInherited,
} from './shell/index.js';
export type { IResolvedShell } from './shell/index.js';
export { createNodeDoctorDeps, resolveCommandOnPath } from './doctor/doctor-node-deps.js';
export { createTerminalClientCommands } from './terminal-client/index.js';
export type {
  ITerminalClientCommand,
  ITerminalClientCommandOptions,
} from './terminal-client/index.js';
