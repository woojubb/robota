import path from 'node:path';

import { readLocalWorkRunTerminals, readWorkRunReceipts } from './work-run-report-files.mjs';
import { queryGitHubPullRequests } from './work-run-report-github.mjs';
import { reportWorkRuns } from './work-run-report-metrics.mjs';

export {
  createGitHubLookupBudget,
  joinPullRequest,
  queryGitHubPullRequest,
  queryGitHubPullRequests,
} from './work-run-report-github.mjs';
export { readLocalWorkRunTerminals, readWorkRunReceipts } from './work-run-report-files.mjs';
export { percentile, reportWorkRuns } from './work-run-report-metrics.mjs';

export function main(
  argv = process.argv.slice(2),
  { queryPullRequests, queryPullRequest, stdout = process.stdout } = {},
) {
  const rootAt = argv.indexOf('--root');
  const root = path.resolve(rootAt === -1 ? process.cwd() : argv[rootAt + 1]);
  const report = reportWorkRuns(
    [...readWorkRunReceipts(root), ...readLocalWorkRunTerminals(root)],
    {
      queryPullRequests:
        queryPullRequests ??
        (queryPullRequest
          ? (receipts, context) => receipts.map((receipt) => queryPullRequest(receipt, context))
          : queryGitHubPullRequests),
    },
  );
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`work-run-report: ${error.message}\n`);
    process.exitCode = 1;
  }
}
