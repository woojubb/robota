/** Command steps that are CI transport/provisioning rather than local checks. */
const install = {
  step: 'Install dependencies',
  reason: 'runner provisioning; a local run is already installed',
};

export const CI_SETUP_STEPS = {
  build: [
    {
      step: 'Plan package-dist artifact membership',
      reason:
        'computes the cross-job archive file list; the local build keeps outputs in place and transports no artifact',
    },
    {
      step: 'Product verification not applicable',
      reason: 'explicit CI applicability result; the local stage gate reports the same omission',
    },
    install,
    {
      step: 'Archive package build output',
      reason:
        'tars dist for the `package-dist` artifact — cross-JOB plumbing with no local counterpart',
    },
    {
      step: 'Binary e2e not applicable',
      reason: 'explicit capability result; the local binary stage gate reports the same omission',
    },
  ],
  quality: [],
  scans: [
    install,
    {
      step: 'Write pull request body for the lane declaration',
      reason:
        'CI transport of the pull-request body into `HARNESS_PR_BODY_FILE` for `scan-lane-declaration`; locally the pull request does not exist yet and the lane is read from the spec frontmatter and the commit trailers (PROC-016)',
    },
  ],
  commitlint: [install],
  'examples-typecheck': [
    {
      step: 'Examples verification not applicable',
      reason: 'explicit CI applicability result; the local stage gate reports the same omission',
    },
    {
      step: 'Restore package build output',
      reason:
        'artifact transport between jobs in one CI run; a local run builds in place and has nothing to restore',
    },
    install,
  ],
  'tui-e2e': [
    {
      step: 'TUI verification not applicable',
      reason: 'explicit CI applicability result; the local stage gate reports the same omission',
    },
    {
      step: 'Restore package build output',
      reason:
        'artifact transport between jobs in one CI run; a local run builds in place and has nothing to restore',
    },
    install,
  ],
};
