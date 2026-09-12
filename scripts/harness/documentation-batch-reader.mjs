import {
  isApprovedDocumentationArchive,
  isApprovedDocumentationBatch,
  LANE_RULE_PATH,
} from './plan-order-records.mjs';

/** Bind the same documentation predicate to committed and staged Git objects, never worktree text. */
export function documentationBatchReader(root, runGit, gitText, indexText, planSignal) {
  const judge = (paths, revision, parent) => {
    const options = {
      paths,
      textBefore: (file) => gitText(root, parent, file),
      textAfter: (file) =>
        revision === null ? indexText(root, file) : gitText(root, revision, file),
      laneRuleText: gitText(root, parent, LANE_RULE_PATH),
      planSignal,
      isPlainBeforeFile: (file) => {
        const result = runGit(root, ['ls-tree', parent, '--', file]);
        return result.code === 0 && /^100644 /.test(result.stdout);
      },
      isPlainFile: (file) => {
        const result = runGit(
          root,
          revision === null
            ? ['ls-files', '--stage', '--', file]
            : ['ls-tree', revision, '--', file],
        );
        return result.code === 0 && /^100644 /.test(result.stdout);
      },
    };
    return isApprovedDocumentationBatch(options) || isApprovedDocumentationArchive(options);
  };
  return {
    commit: (entry) => judge(entry.paths, entry.commit, entry.parent),
    staged: (paths) => judge(paths, null, 'HEAD'),
  };
}
