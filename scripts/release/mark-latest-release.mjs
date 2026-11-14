/**
 * Marks the highest verified release tag as the repository's Latest release.
 *
 * Release producers create their GitHub release with `--latest=false`, because the install scripts
 * resolve `releases/latest/download/...` and a release that only some producers have filled must
 * never be what they find. Latest is set here, once, after every producer of the tag is verified.
 *
 * Latest only moves forward: a tag whose version is not strictly higher than the current Latest's is
 * left alone, so re-verifying an older tag later cannot take Latest back. Prereleases are skipped
 * because GitHub cannot mark them Latest.
 *
 * Usage: READY_TAGS='<space-separated tags>' GH_REPO=<owner/repo> node scripts/release/mark-latest-release.mjs
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TAG_PATTERN = /^[A-Za-z0-9._+-]+$/;
const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)(-)?/;

// The first MAJOR.MINOR.PATCH in a tag, whatever prefix precedes it ("v", "app-v", ...).
function parseVersion(tag) {
  const match = VERSION_PATTERN.exec(tag);
  if (!match) return undefined;
  return { core: match.slice(1, 4).map(Number), prerelease: match[4] !== undefined };
}

function compareCores(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The tag to mark Latest, or undefined when no ready tag is a stable version above `currentLatest`. */
export function selectLatestTag({ readyTags, currentLatest }) {
  let best;
  for (const tag of readyTags) {
    if (!TAG_PATTERN.test(tag)) throw new Error(`Unsafe release tag ${JSON.stringify(tag)}`);
    const version = parseVersion(tag);
    if (!version || version.prerelease) continue;
    if (!best || compareCores(version.core, best.core) > 0) best = { tag, core: version.core };
  }
  if (!best || currentLatest === undefined) return best?.tag;
  const current = parseVersion(currentLatest);
  if (!current) throw new Error(`Cannot compare with the current Latest tag ${currentLatest}`);
  return compareCores(best.core, current.core) > 0 ? best.tag : undefined;
}

/**
 * `gh(args)` runs the GitHub CLI and returns `{ status, stdout, stderr }` without throwing.
 * Returns `{ tag, message }`: `tag` is the release marked Latest, undefined when Latest was left alone.
 */
export function markLatestRelease({ tags, repo, gh }) {
  if (tags.length === 0) throw new Error('No verified release tags were provided');
  const lookup = gh(['api', `repos/${repo}/releases/latest`, '--jq', '.tag_name']);
  let currentLatest;
  if (lookup.status === 0) {
    currentLatest = lookup.stdout.trim();
    if (!currentLatest) throw new Error('The Latest release lookup returned no tag');
  } else if (!/HTTP 404/.test(lookup.stderr)) {
    throw new Error(`Could not read the current Latest release: ${lookup.stderr.trim()}`);
  }
  const tag = selectLatestTag({ readyTags: tags, currentLatest });
  if (tag === undefined)
    return {
      message: `Latest stays ${currentLatest ?? 'unset'}: none of ${tags.join(' ')} is a stable release above it.`,
    };
  const edit = gh(['release', 'edit', tag, '--repo', repo, '--latest']);
  if (edit.status !== 0)
    throw new Error(`gh release edit ${tag} --latest failed: ${edit.stderr.trim()}`);
  return { tag, message: `Marked ${tag} as the Latest release (was ${currentLatest ?? 'unset'}).` };
}

function runGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function main() {
  const tags = (process.env.READY_TAGS ?? '').split(/\s+/).filter(Boolean);
  const repo = process.env.GH_REPO;
  if (!repo) throw new Error('GH_REPO is required');
  process.stdout.write(`${markLatestRelease({ tags, repo, gh: runGh }).message}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`::error::${error.message}\n`);
    process.exitCode = 1;
  }
}
