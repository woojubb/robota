/**
 * A node script that reads ONE line from the inherited terminal and prints `<label>:[<line>]`, so a
 * handoff fixture can prove its child owned the TTY. It uses single quotes only, which lets a caller
 * put it inside a double-quoted `node -e "..."` shell command that `sh` and PowerShell run the same.
 */
export function readOneLineScript(label: string): string {
  return `require('readline').createInterface({input:process.stdin}).once('line',l=>{console.log('${label}:['+l+']');process.exit(0)})`;
}
