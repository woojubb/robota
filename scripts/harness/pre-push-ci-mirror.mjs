export const CI_BASE_REF_PLACEHOLDER = 'origin/$GITHUB_BASE_REF';
export const CI_HEAD_REF_PLACEHOLDER = 'HEAD';

export const CI_SCANS_JOB_MIRROR = [
  [
    'pnpm',
    [
      'harness:test:contracts:affected',
      '--',
      '--base-ref',
      CI_BASE_REF_PLACEHOLDER,
      '--head-ref',
      CI_HEAD_REF_PLACEHOLDER,
    ],
  ],
  ['pnpm', ['harness:test:hermetic']],
  [
    'pnpm',
    [
      'harness:scan',
      '--',
      '--skip',
      'dist',
      '--skip',
      'build-contracts',
      '--affected',
      '--context',
      'pr',
      '--base',
      CI_BASE_REF_PLACEHOLDER,
    ],
  ],
];

const PATH_GATED_HARNESS_TEST = 'harness:test:hermetic';

function substituteRefs(args, { baseRef, headRef }) {
  let resolved = args.map((arg) =>
    arg === CI_BASE_REF_PLACEHOLDER ? baseRef : arg === CI_HEAD_REF_PLACEHOLDER ? headRef : arg,
  );
  if (!baseRef) {
    resolved = resolved.filter(
      (arg, index) =>
        !(
          arg === '--base' ||
          arg === '--base-ref' ||
          (index > 0 && (resolved[index - 1] === '--base' || resolved[index - 1] === '--base-ref'))
        ),
    );
  }
  if (!headRef) {
    resolved = resolved.filter(
      (arg, index) => arg !== '--head-ref' && !(index > 0 && resolved[index - 1] === '--head-ref'),
    );
  }
  return resolved;
}

export function createCiScansJobMirror(
  classification,
  { baseRef = null, headRef = CI_HEAD_REF_PLACEHOLDER, full = false } = {},
) {
  const harnessApplicable = classification?.harness !== false;
  return CI_SCANS_JOB_MIRROR.filter(
    ([, args]) => args[0] !== PATH_GATED_HARNESS_TEST || harnessApplicable,
  ).map(([command, args]) => {
    if (full && args[0] === 'harness:test:contracts:affected') {
      return [command, ['harness:test:contracts']];
    }
    return [command, substituteRefs(args, { baseRef, headRef })];
  });
}
