function parseValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${optionName} requires a value`);
  return value;
}

export function parsePlanArgs(argv) {
  const options = {
    scopeTokens: [],
    changedFiles: [],
    baseRef: null,
    reportFile: null,
    reportFormat: null,
    skipDependentScopes: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--':
        break;
      case '--scope':
        options.scopeTokens.push(parseValue(argv, index, '--scope'));
        index += 1;
        break;
      case '--changed-file':
        options.changedFiles.push(parseValue(argv, index, '--changed-file'));
        index += 1;
        break;
      case '--base-ref':
        options.baseRef = parseValue(argv, index, '--base-ref');
        index += 1;
        break;
      case '--report-file':
        options.reportFile = parseValue(argv, index, '--report-file');
        index += 1;
        break;
      case '--report-format': {
        const value = parseValue(argv, index, '--report-format');
        if (value !== 'markdown' && value !== 'json') {
          throw new Error('--report-format must be one of: markdown, json');
        }
        options.reportFormat = value;
        index += 1;
        break;
      }
      case '--skip-dependent-scopes':
        options.skipDependentScopes = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return options;
}
