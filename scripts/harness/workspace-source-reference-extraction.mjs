import path from 'node:path';

import * as ts from './lib/ts-ast.mjs';

function literalModuleReference(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  if (ts.isImportTypeNode(node)) return node.argument?.literal;
  if (!ts.isCallExpression(node)) return undefined;
  const expression = node.expression;
  const isRequire = ts.isIdentifier(expression) && expression.text === 'require';
  const isRequireResolve =
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'require' &&
    expression.name.text === 'resolve';
  if (expression.kind === ts.SyntaxKind.ImportKeyword || isRequire || isRequireResolve) {
    if ((isRequire || isRequireResolve) && isParameterShadowed(node, 'require')) return undefined;
    return node.arguments[0];
  }
  return undefined;
}

function importedBindings(parsed) {
  const bindings = new Map();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const defaultBinding = statement.importClause?.name;
    if (defaultBinding) {
      bindings.set(defaultBinding.text, {
        module: statement.moduleSpecifier.text,
        namespace: true,
      });
    }
    const named = statement.importClause?.namedBindings;
    if (named?.kind === ts.SyntaxKind.NamespaceImport) {
      bindings.set(named.name.text, { module: statement.moduleSpecifier.text, namespace: true });
      continue;
    }
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      bindings.set(element.name.text, {
        module: statement.moduleSpecifier.text,
        name: (element.propertyName ?? element.name).text,
      });
    }
  }
  return bindings;
}

function topLevelInitializers(parsed) {
  const initializers = new Map();
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        initializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return initializers;
}

function staticPathValue(node, { bindings, fileName, initializers }, seen = new Set()) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return undefined;
    const initializer = initializers.get(node.text);
    if (!initializer) return undefined;
    return staticPathValue(
      initializer,
      { bindings, fileName, initializers },
      new Set([...seen, node.text]),
    );
  }
  if (ts.isPropertyAccessExpression(node) && node.getText() === 'import.meta.dirname') {
    return path.posix.dirname(fileName);
  }
  if (!ts.isCallExpression(node)) return undefined;
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.getText() === 'process.cwd' &&
    node.arguments.length === 0
  ) {
    return '.';
  }
  const expression = node.expression;
  const namespaceCall =
    ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression);
  const identifier = namespaceCall ? expression.expression : expression;
  if (!ts.isIdentifier(identifier)) return undefined;
  const binding = bindings.get(identifier.text);
  if (!binding || !['node:path', 'path'].includes(binding.module)) return undefined;
  const operation = namespaceCall ? expression.name.text : binding.name;
  if (!['join', 'resolve'].includes(operation)) return undefined;
  const parts = node.arguments.map((argument) =>
    staticPathValue(argument, { bindings, fileName, initializers }, seen),
  );
  if (parts.some((part) => part === undefined)) return undefined;
  return path.posix.normalize(path.posix.join(...parts));
}

function bindingDeclares(binding, name) {
  if (!binding) return false;
  if (ts.isIdentifier(binding)) return binding.text === name;
  if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
    return binding.elements.some((element) => bindingDeclares(element.name, name));
  }
  return false;
}

function isParameterShadowed(node, name) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.parameters?.some((parameter) => bindingDeclares(parameter.name, name))) {
      return true;
    }
  }
  return false;
}

function isImportedBindingShadowed(node, name) {
  if (isParameterShadowed(node, name)) return true;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      parent.kind === ts.SyntaxKind.CatchClause &&
      bindingDeclares(parent.variableDeclaration?.name, name)
    )
      return true;
    if (
      [
        ts.SyntaxKind.ForStatement,
        ts.SyntaxKind.ForInStatement,
        ts.SyntaxKind.ForOfStatement,
      ].includes(parent.kind) &&
      parent.initializer?.kind === ts.SyntaxKind.VariableDeclarationList &&
      parent.initializer.declarations.some((declaration) => bindingDeclares(declaration.name, name))
    ) {
      return true;
    }
    if (parent.kind !== ts.SyntaxKind.Block) continue;
    for (const statement of parent.statements) {
      if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        bindingDeclares(statement.name, name)
      )
        return true;
      if (statement.kind !== ts.SyntaxKind.VariableStatement) continue;
      if (
        statement.declarationList.declarations.some((declaration) =>
          bindingDeclares(declaration.name, name),
        )
      )
        return true;
    }
  }
  return false;
}

function executionCwdArgument(node) {
  const options =
    node.arguments[1]?.kind === ts.SyntaxKind.ArrayLiteralExpression
      ? node.arguments[2]
      : node.arguments[1];
  if (!options || ts.isArrowFunction(options) || ts.isFunctionExpression(options)) return undefined;
  const unknown = { argument: options, literal: false };
  if (options.kind !== ts.SyntaxKind.ObjectLiteralExpression) return unknown;
  if (
    options.properties.some(
      (entry) =>
        entry.kind === ts.SyntaxKind.SpreadAssignment ||
        entry.name?.kind === ts.SyntaxKind.ComputedPropertyName,
    )
  )
    return unknown;
  const properties = options.properties.filter((entry) => entry.name?.text === 'cwd');
  if (properties.length === 0) return undefined;
  if (properties.length !== 1 || properties[0].kind !== ts.SyntaxKind.PropertyAssignment)
    return unknown;
  return { argument: properties[0].initializer, literal: true };
}

function fileReadReference(node, bindings) {
  if (!ts.isCallExpression(node)) return undefined;
  const expression = node.expression;
  const namespaceCall =
    ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression);
  const identifier = namespaceCall ? expression.expression : expression;
  if (!ts.isIdentifier(identifier)) return undefined;
  const binding = bindings.get(identifier.text);
  if (!binding) return undefined;
  if (namespaceCall !== Boolean(binding.namespace)) return undefined;
  const name = namespaceCall ? expression.name.text : binding.name;
  const filesystem = ['node:fs', 'fs', 'node:fs/promises', 'fs/promises'].includes(binding.module);
  const childProcess = ['node:child_process', 'child_process'].includes(binding.module);
  const kind =
    childProcess && ['execFile', 'execFileSync'].includes(name)
      ? 'execute'
      : filesystem && ['readFile', 'readFileSync'].includes(name)
        ? 'read-content'
        : filesystem && ['readdir', 'readdirSync'].includes(name)
          ? 'list-names'
          : undefined;
  if (!kind || isImportedBindingShadowed(node, identifier.text)) return undefined;
  const executionCwd = kind === 'execute' ? executionCwdArgument(node) : undefined;
  let argument = node.arguments[0];
  if (!argument) return undefined;
  if (
    kind === 'execute' &&
    ts.isPropertyAccessExpression(argument) &&
    ts.isIdentifier(argument.expression) &&
    argument.expression.text === 'process' &&
    argument.name.text === 'execPath' &&
    !isParameterShadowed(node, 'process') &&
    node.arguments[1]?.kind === ts.SyntaxKind.ArrayLiteralExpression
  ) {
    const script = node.arguments[1].elements[0];
    if (
      script &&
      (ts.isStringLiteral(script) || ts.isNoSubstitutionTemplateLiteral(script)) &&
      !script.text.startsWith('-')
    )
      argument = script;
  }
  const base = argument.kind === ts.SyntaxKind.NewExpression ? argument.arguments?.[1] : undefined;
  if (
    base &&
    ts.isIdentifier(argument.expression) &&
    argument.expression.text === 'URL' &&
    ts.isPropertyAccessExpression(base) &&
    base.name.text === 'url' &&
    base.expression.kind === ts.SyntaxKind.MetaProperty &&
    base.expression.name.text === 'meta'
  ) {
    return { argument: argument.arguments[0], kind, anchor: 'source', executionCwd };
  }
  return { argument, kind, anchor: 'cwd', executionCwd };
}

export function extractSourceReferences(source, fileName = 'workspace-reference.ts') {
  const text = String(source ?? '');
  const references = [];
  return ts.withSourceFile(fileName, text, (parsed) => {
    const bindings = importedBindings(parsed);
    const initializers = topLevelInitializers(parsed);
    const visit = (node) => {
      const moduleReference = literalModuleReference(node);
      const input = moduleReference
        ? { argument: moduleReference, kind: 'module', anchor: 'source' }
        : fileReadReference(node, bindings);
      const reference = input?.argument;
      if (reference) {
        const literal =
          ts.isStringLiteral(reference) || ts.isNoSubstitutionTemplateLiteral(reference);
        const staticSpecifier = literal
          ? reference.text
          : staticPathValue(reference, { bindings, fileName, initializers });
        references.push({
          source: fileName,
          span: { start: reference.pos, end: reference.end },
          kind: input.kind,
          anchor: input.anchor,
          ...(ts.isImportDeclaration(node)
            ? {
                // Detached static import names, before local aliases. Namespace/dynamic imports
                // do not prove use of any particular API from the imported module.
                importedNames:
                  node.importClause?.namedBindings &&
                  ts.isNamedImports(node.importClause.namedBindings)
                    ? node.importClause.namedBindings.elements.map(
                        (element) => (element.propertyName ?? element.name).text,
                      )
                    : [],
              }
            : {}),
          ...(input.executionCwd
            ? {
                executionCwd: {
                  span: {
                    start: input.executionCwd.argument.pos,
                    end: input.executionCwd.argument.end,
                  },
                  expression: text
                    .slice(input.executionCwd.argument.pos, input.executionCwd.argument.end)
                    .trim(),
                  ...(input.executionCwd.literal &&
                  (ts.isStringLiteral(input.executionCwd.argument) ||
                    ts.isNoSubstitutionTemplateLiteral(input.executionCwd.argument))
                    ? { specifier: input.executionCwd.argument.text }
                    : {}),
                },
              }
            : {}),
          ...(staticSpecifier === undefined ? {} : { specifier: staticSpecifier }),
          expression: text.slice(reference.pos, reference.end).trim(),
          typeOnly:
            ts.isImportTypeNode(node) ||
            (ts.isImportDeclaration(node) && ts.isTypeOnlyImportClause(node.importClause)),
        });
      }
      node.forEachChild(visit);
    };
    visit(parsed);
    return references;
  });
}
