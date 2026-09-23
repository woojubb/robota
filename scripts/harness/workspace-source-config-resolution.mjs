import path from 'node:path';

import {
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isStringLiteral,
  withSourceFile,
} from './lib/ts-ast.mjs';

export function isRepositoryPath(file) {
  if (
    typeof file !== 'string' ||
    !file ||
    file.includes('\\') ||
    file.includes('\0') ||
    /^[a-zA-Z]:/.test(file)
  )
    return false;
  const normalized = path.posix.normalize(file);
  return normalized !== '..' && !normalized.startsWith('../') && !path.posix.isAbsolute(file);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// JSONC permits comments and trailing commas, not JavaScript expressions. Preserve string
// tokens in both passes; JSON.parse remains the syntax/value boundary (nothing is evaluated).
const CONFIG_PREFIX = 'const config = (';

function parseJsonConfig(file, text, visit = (value) => value) {
  return withSourceFile(file, `${CONFIG_PREFIX}${text});`, (source) => {
    const initializer = source.statements[0]?.declarationList?.declarations[0]?.initializer;
    if (
      !initializer ||
      !isParenthesizedExpression(initializer) ||
      !isObjectLiteralExpression(initializer.expression)
    ) {
      throw new Error('invalid-config-object');
    }
    // The AST scopes syntax inspection to its snapshot. JSON.parse also rejects parser recovery
    // and JS-only constructs; only detached JSON data may leave this synchronous callback.
    return visit(parseJsonConfigValue(text), initializer.expression, source);
  });
}

/** Direct configuration inputs only; detached spans refer to the original JSONC text. */
export function extractConfigReferences(text, source) {
  if (!/^tsconfig(?:\.[^/]+)?\.json$/u.test(path.posix.basename(source))) return [];
  return parseJsonConfig(source, text, (config, object, ast) => {
    configParents(config);
    const property = [...object.properties]
      .reverse()
      .find((entry) => isPropertyAssignment(entry) && entry.name?.text === 'extends');
    if (!property) return [];
    const value = property.initializer;
    const literals = isStringLiteral(value) ? [value] : [...value.elements];
    return literals.map((literal) => {
      const span = {
        start: literal.getStart(ast) - CONFIG_PREFIX.length,
        end: literal.end - CONFIG_PREFIX.length,
      };
      const expression = text.slice(span.start, span.end);
      return {
        source,
        span,
        kind: 'config',
        anchor: 'source',
        specifier: JSON.parse(expression),
        expression,
      };
    });
  });
}

function parseJsonConfigValue(text) {
  const withoutComments = text.replace(
    /("(?:[^"\\]|\\[\s\S])*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (token, string) => string ?? token.replace(/[^\r\n]/g, ' '),
  );
  return JSON.parse(
    withoutComments.replace(
      /("(?:[^"\\]|\\[\s\S])*")|,(?=\s*[}\]])/g,
      (_token, string) => string ?? '',
    ),
  );
}

/**
 * The caller's analysis owns this optional cache. Keep only the latest content per file/kind,
 * and re-read before reuse so edits, malformed replacements and fixes invalidate immediately.
 * Only detached JSON values/errors are retained, never native AST nodes or snapshots.
 */
export function readParsedResolutionInput(file, context, kind) {
  const text = context.readFile(file);
  const key = `${kind}:${file}`;
  const cached = context.parsedInputs?.get(key);
  if (cached?.text === text) {
    if (!cached.ok) throw cached.error;
    return cached.value;
  }
  try {
    const value = kind === 'config' ? parseJsonConfig(file, text) : JSON.parse(text);
    context.parsedInputs?.set(key, { text, ok: true, value });
    return value;
  } catch (error) {
    context.parsedInputs?.set(key, { text, ok: false, error });
    throw error;
  }
}

export function nearestResolutionFile(source, name, files) {
  for (let directory = path.posix.dirname(source); ; directory = path.posix.dirname(directory)) {
    const candidate = path.posix.join(directory, name);
    if (files.has(candidate)) return candidate;
    if (directory === '.') return undefined;
  }
}

function readConfig(file, context, evidence, visiting) {
  if (!isRepositoryPath(file)) throw new Error('config-escapes-repository');
  evidence.add(file);
  if (visiting.has(file)) throw new Error('cyclic-config-extends');
  visiting.add(file);
  const config = readParsedResolutionInput(file, context, 'config');
  if (!isRecord(config)) throw new Error('invalid-config-object');
  let inherited = {};
  for (const parentSpecifier of configParents(config)) {
    if (!parentSpecifier.startsWith('.')) {
      const manifest = nearestResolutionFile(file, 'package.json', context.files);
      if (manifest) evidence.add(manifest);
      throw new Error('package-config-unavailable');
    }
    const relative = path.posix.join(path.posix.dirname(file), parentSpecifier);
    const parent = [relative, `${relative}.json`].find((candidate) => context.files.has(candidate));
    if (!parent) {
      if (isRepositoryPath(relative)) evidence.add(relative);
      throw new Error('missing-config-extends');
    }
    inherited = { ...inherited, ...readConfig(parent, context, evidence, visiting) };
  }
  visiting.delete(file);
  return { ...inherited, ...configOptions(config.compilerOptions ?? {}, file) };
}

function configParents(config) {
  const parents =
    config.extends === undefined
      ? []
      : typeof config.extends === 'string'
        ? [config.extends]
        : config.extends;
  if (!Array.isArray(parents) || parents.some((value) => typeof value !== 'string')) {
    throw new Error('invalid-config-extends');
  }
  return parents;
}

function validPaths(paths) {
  return (
    isRecord(paths) &&
    Object.entries(paths).every(
      ([key, values]) =>
        key.split('*').length <= 2 &&
        Array.isArray(values) &&
        values.length > 0 &&
        values.every(
          (value) =>
            typeof value === 'string' &&
            !path.posix.isAbsolute(value) &&
            !value.includes('\\') &&
            !/^[a-zA-Z]:/.test(value) &&
            value.split('*').length <= 2,
        ),
    )
  );
}

function configOptions(options, file) {
  if (!isRecord(options)) throw new Error('invalid-compilerOptions');
  if (
    options.baseUrl !== undefined &&
    (typeof options.baseUrl !== 'string' ||
      path.posix.isAbsolute(options.baseUrl) ||
      !isRepositoryPath(path.posix.join(path.posix.dirname(file), options.baseUrl)))
  ) {
    throw new Error('invalid-baseUrl');
  }
  if (options.paths !== undefined && !validPaths(options.paths)) {
    throw new Error('invalid-paths');
  }
  return {
    ...(options.baseUrl === undefined
      ? {}
      : {
          baseUrl: path.posix.join(path.posix.dirname(file), options.baseUrl),
        }),
    ...(options.paths === undefined
      ? {}
      : {
          paths: options.paths,
          pathsBase: path.posix.dirname(file),
        }),
  };
}

/** Read only declared regular config files; the caller owns source-target resolution. */
export function readSourceConfig(source, context) {
  const evidence = new Set();
  const file = nearestResolutionFile(source, 'tsconfig.json', context.files);
  if (!file) return { evidenceInputs: [] };
  try {
    return {
      ...readConfig(file, context, evidence, new Set()),
      evidenceInputs: [...evidence].sort(),
    };
  } catch (error) {
    return { reason: `config-resolution: ${error.message}`, evidenceInputs: [...evidence].sort() };
  }
}
