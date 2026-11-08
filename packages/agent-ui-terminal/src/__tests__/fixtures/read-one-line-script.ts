/**
 * A node script that reads ONE line from the inherited terminal and prints `<label>:[<line>]`, so a
 * handoff fixture can prove its child owned the TTY. It first prints `<label>_READY`, so a test can
 * wait until the child owns the terminal before it types: keys sent earlier reach the TUI's own
 * input hook instead. The marker is assembled at run time, so the script's own source (which a shell
 * may echo) never contains it. It uses single quotes only, which lets a caller put it inside a
 * double-quoted `node -e "..."` shell command that `sh` and PowerShell run the same.
 */
export function readOneLineScript(label: string): string {
  return `console.log('${label}'+'_READY');require('readline').createInterface({input:process.stdin}).once('line',l=>{console.log('${label}:['+l+']');process.exit(0)})`;
}
