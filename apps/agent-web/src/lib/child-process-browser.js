// Browser stub for node:child_process — shell commands cannot run in a browser context
export function spawn() {
  throw new Error('spawn is not available in browser context');
}
export function exec() {
  throw new Error('exec is not available in browser context');
}
export function execSync() {
  throw new Error('execSync is not available in browser context');
}
export function spawnSync() {
  throw new Error('spawnSync is not available in browser context');
}
export function fork() {
  throw new Error('fork is not available in browser context');
}
export default { spawn, exec, execSync, spawnSync, fork };
