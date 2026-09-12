/** Optional local diagnostic stages and the CI steps they exercise, not a merge verdict. */
export const CI_STAGES = [
  {
    name: 'format-check',
    needsBuildOutput: false,
    extra: '.lintstagedrc.json (prettier via .husky/pre-commit)',
    why: 'formatting is the ONE local stage no REQUIRED CI check re-runs, so a bypassed hook shipped drift nothing caught (INFRA-083)',
  },
  {
    name: 'commitlint',
    needsBuildOutput: false,
    mirrors: [{ job: 'commitlint', steps: ['Lint PR commit messages'] }],
    why: 'a subject over the length limit fails a REQUIRED check after the push, for a defect visible before it',
  },
  {
    name: 'build',
    needsBuildOutput: false,
    mirrors: [
      {
        job: 'build',
        steps: [
          'Show verification plan',
          'Detect build requirement',
          'Build full or affected workspace',
          'Skip monorepo build when no build output is required',
        ],
      },
      { job: 'examples-typecheck', steps: ['Guarantee affected example consumer dist'] },
      { job: 'tui-e2e', steps: ['Guarantee CLI and TUI consumer dist'] },
    ],
    why: 'runs the affected owner/prerequisite build once; full build is reserved for product-wide root or graph changes',
  },
  {
    name: 'scan-suite',
    needsBuildOutput: true,
    mirrors: [{ job: 'build', steps: ['Build-output contracts scan (dist-dependent)'] }],
    why: 'the dist-dependent scans silently no-op on an unbuilt tree',
  },
  {
    name: 'package-quality',
    needsBuildOutput: true,
    mirrors: [
      { job: 'build', steps: ['Verify full or affected package quality concurrently'] },
      { job: 'quality', steps: ['Publish the product verification verdict'] },
    ],
    why: 'runs test, typecheck and lint concurrently through the same full-or-affected split as the required quality job',
  },
  {
    name: 'binary-e2e',
    needsBuildOutput: true,
    mirrors: [
      {
        job: 'build',
        steps: [
          'Build desktop Electron app for e2e',
          'Binary e2e (agent-cli bintests, dist-dependent)',
          'Desktop Electron session e2e',
          'Desktop Electron usage and protocol reachability e2e',
        ],
      },
    ],
    why: 'black-box e2e over built CLI and desktop entry points; unit suites do not cover packaged product wiring',
  },
  {
    name: 'examples-typecheck',
    needsBuildOutput: true,
    mirrors: [{ job: 'examples-typecheck', steps: ['Typecheck examples'] }],
    why: 'examples are outside the workspace typecheck; a breaking public-surface change is invisible without them',
  },
  {
    name: 'tui-e2e',
    needsBuildOutput: true,
    mirrors: [{ job: 'tui-e2e', steps: ['Run the TUI PTY E2E suite against the real binary'] }],
    why: 'the live-TUI behaviours only a real PTY against the built binary can exercise',
  },
];
