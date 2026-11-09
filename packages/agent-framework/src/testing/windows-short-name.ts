import { execFileSync } from 'node:child_process';

/**
 * A directory's 8.3 short name (`TRUSTE~1`), or undefined where the volume keeps none or the host is
 * not Windows. A test that needs a short-name spelling of a directory it created asks here.
 */
export function windowsShortSpelling(directory: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const short = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:SPELLED_PATH).ShortPath',
    ],
    { encoding: 'utf8', env: { ...process.env, SPELLED_PATH: directory } },
  ).trim();
  return short.includes('~') ? short : undefined;
}
