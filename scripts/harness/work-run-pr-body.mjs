export function terminalPullRequestWorkRunId(body) {
  if (typeof body !== 'string') {
    throw new Error('GitHub PR body needs exactly one terminal Work-Run marker');
  }
  const lines = body.trimEnd().split(/\r?\n/u);
  const markers = lines
    .map((line, index) => ({ index, match: /^Work-Run:\s*(\S+)\s*$/u.exec(line) }))
    .filter(({ match }) => match !== null);
  if (markers.length !== 1 || markers[0].index !== lines.length - 1) {
    throw new Error('GitHub PR body needs exactly one terminal Work-Run marker');
  }
  return markers[0].match[1];
}
