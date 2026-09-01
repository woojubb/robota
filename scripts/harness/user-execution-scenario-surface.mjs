import path from 'node:path';

export function tokenizeCanonicalShell(value) {
  const trimmed = value.trim();
  const unwrapped =
    trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1).trim() : trimmed;
  if (!unwrapped || /[\r\n]/.test(unwrapped)) return null;
  const tokens = [];
  const operators = [];
  let token = '';
  let tokenStarted = false;
  let quote = null;
  let escaped = false;
  const finishToken = () => {
    if (tokenStarted) tokens.push(token);
    token = '';
    tokenStarted = false;
  };
  for (let index = 0; index < unwrapped.length; index += 1) {
    const character = unwrapped[index];
    if (escaped) {
      token += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      else token += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === '\\') {
        const next = unwrapped[index + 1];
        if (next !== undefined && '$`"\\\n'.includes(next)) escaped = true;
        else token += character;
      } else if (character === '`' || (character === '$' && unwrapped[index + 1] === '(')) {
        return null;
      } else token += character;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      finishToken();
      continue;
    }
    if ('&;<>'.includes(character) || character === '`') return null;
    if (character === '$' && unwrapped[index + 1] === '(') return null;
    if (character === '|') {
      finishToken();
      operators.push({ tokenIndex: tokens.length, operator: '|' });
      continue;
    }
    token += character;
    tokenStarted = true;
  }
  if (quote !== null || escaped) return null;
  finishToken();
  if (operators.length > 1) return null;
  if (operators.length === 1) {
    const pipe = operators[0];
    if (tokens[pipe.tokenIndex] !== 'grep' || pipe.tokenIndex === 0) return null;
  }
  return tokens.length > 0 ? { invocation: unwrapped, tokens, operators } : null;
}

function canonicalExamplePath(candidate) {
  if (!candidate || path.posix.isAbsolute(candidate) || /[$*?[\]{}~]/.test(candidate)) return null;
  const segments = candidate.replace(/^\.\//, '').split('/');
  if (segments.includes('..') || !['examples', 'scratch'].includes(segments[0])) return null;
  const normalized = path.posix.normalize(segments.join('/'));
  return /^(?:examples|scratch)\/.+/.test(normalized) ? normalized : null;
}

function commandScriptPath(tokens) {
  let cursor = tokens[0] === 'pnpm' ? 3 : 1;
  const safeOptions = new Set(['--enable-source-maps', '--no-warnings', '--trace-warnings']);
  while (cursor < tokens.length && tokens[cursor].startsWith('-')) {
    const option = tokens[cursor];
    if (option === '--') {
      cursor += 1;
      break;
    }
    if (!safeOptions.has(option)) return null;
    cursor += 1;
  }
  return tokens[cursor] ?? null;
}

export function canonicalProductStatePath(candidate) {
  if (
    !candidate ||
    path.posix.isAbsolute(candidate) ||
    /[$*?[\]{}~\\]/.test(candidate) ||
    candidate.split('/').includes('..')
  ) {
    return null;
  }
  const normalized = path.posix.normalize(candidate.replace(/^\.\//, ''));
  return /^\.robota\/.*[^/]$/.test(normalized) ? normalized : null;
}

export function productSurfaceInvocation(surface, command, uiSteps, browserSteps) {
  const shell = command === null ? null : tokenizeCanonicalShell(command);
  const invocation = shell?.invocation ?? browserSteps?.trim() ?? uiSteps?.trim() ?? null;
  if (!invocation) return null;
  if (surface === 'robota-cli' || surface === 'robota-tui') {
    const prefix = shell?.tokens.slice(0, 3).join(' ') ?? '';
    return shell && (shell.tokens[0] === 'robota' || prefix === 'pnpm exec robota')
      ? invocation
      : null;
  }
  if (surface === 'robota-browser-ui') {
    return browserSteps !== null || uiSteps !== null ? invocation : null;
  }
  if (surface === 'public-sdk-example') {
    if (!shell) return null;
    const direct =
      shell.tokens[0] === 'node' || shell.tokens[0] === 'tsx'
        ? commandScriptPath(shell.tokens)
        : shell.tokens.slice(0, 3).join(' ') === 'pnpm exec tsx'
          ? commandScriptPath(shell.tokens)
          : null;
    const hasPnpmDirectoryShape =
      shell.tokens[0] === 'pnpm' &&
      (shell.tokens[1] === '--dir' || shell.tokens[1] === '-C') &&
      shell.tokens[3] === 'run' &&
      Boolean(shell.tokens[4]) &&
      !shell.tokens[4].startsWith('-') &&
      !/[$*?[\]{}~]/.test(shell.tokens[4]);
    const workingDirectory = hasPnpmDirectoryShape ? shell.tokens[2] : null;
    return canonicalExamplePath(direct ?? workingDirectory) !== null ? invocation : null;
  }
  return null;
}
