import {
  assertLocalBranchSubject,
  currentClaimIdentity,
  lockLocalBranchSubject,
} from './work-run-git.mjs';

export function createWorkRunSubjectGuard(root, original) {
  let locked = original;
  return {
    lock() {
      locked =
        original.headRef === 'HEAD' ? lockLocalBranchSubject(root, original.branch) : original;
      return locked;
    },
    current() {
      return locked;
    },
    validate() {
      if (original.headRef === 'HEAD') assertLocalBranchSubject(root, locked);
    },
  };
}

export function claimWorkRunSubject({ store, root, subject, at }) {
  const guard = createWorkRunSubjectGuard(root, subject);
  return store.claim({
    branch: subject.branch,
    identity: () => {
      const locked = guard.lock();
      return currentClaimIdentity(root, locked.branch, locked.headRef);
    },
    validate: () => guard.validate(),
    at,
  });
}
