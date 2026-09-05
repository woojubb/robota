#!/usr/bin/env node

/**
 * The changesets `fixed` group, checked against the workspace it claims to describe (REL-025).
 *
 * Split out of `check-release-governance.mjs` rather than added to it: that file sits exactly on its
 * frozen `file-size` line, and the rule there is that pre-existing debt may shrink but never grow.
 * It is imported by `check-release-governance.mjs`, which is registered in the scan suite, so this
 * module needs no scan registration of its own.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { listManifestPackageDirs } from './workspace-packages.mjs';

/**
 * ## What this checks — both directions, by owner decision
 *
 * The `fixed` group and the set of packages this workspace PUBLISHES (`packages/**\/package.json`
 * with `private !== true`) must be the same set, and the published packages must sit in ONE group:
 *
 * 1. Group ⊆ published — every name in the group resolves to a published package. A group entry
 *    pointing at a deleted, renamed or private package is a dangling reference under any release
 *    model, and it is exactly the state that made `changeset status` refuse to assemble a release
 *    plan at all: the leaf named `agent-provider-defaults` (scope elided — the token no longer
 *    resolves to anything) was renamed on 2026-08-23 and two pending changesets still named it.
 * 2. Published ⊆ group — every published package is in the group. This is the direction the owner
 *    decision on issue #2475 (2026-09-05, option A: "고정 그룹이 권위") made assertable: the
 *    version-management skill's rule 4 says all `@robota-sdk/*` packages share one `fixed` group,
 *    and a published package left out of it is the drift mechanism itself — a leaf with no
 *    `workspace:*` dependency receives no dependent bump from `updateInternalDependencies`, and with
 *    no changeset of its own it is simply not versioned, which is how `agent-process` fell to
 *    `3.0.0-beta.77` while the other 36 moved to `beta.79`.
 * 3. One group — rule 4 says "the same `fixed` group", so published packages split across several
 *    groups are reported even when every one of them is in some group.
 *
 * Membership is by literal name. The group is written as explicit names, never a glob, so that the
 * config and this scan read the same list and the "add a new package" procedure stays a visible
 * config edit that this scan refuses to let anyone forget.
 *
 * ## Why every unreadable input is a finding
 *
 * A scan that cannot read its inputs and reports nothing is indistinguishable from a scan that
 * read them and found agreement, and the second is the claim the exit code makes. So a missing
 * `packages/`, an unparseable manifest, an unparseable config and an absent `fixed` key each
 * produce a finding that NAMES what could not be read, and none of them degrade to an empty set.
 * An unreadable manifest also makes the published set INCOMPLETE, which forbids direction 1's
 * absence claim ("this entry names nothing") for that run — but not direction 2's: a manifest that
 * WAS read is a published package whether or not another one could be.
 */
export function collectChangesetFixedGroupFindings(workspaceRoot) {
  const findings = [];
  const configPath = '.changeset/config.json';
  const absoluteConfigPath = path.join(workspaceRoot, configPath);
  if (!existsSync(absoluteConfigPath)) {
    findings.push({ file: configPath, detail: 'Required release governance file is missing.' });
    return findings;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(absoluteConfigPath, 'utf8'));
  } catch {
    // allow-fallback: the parse failure IS the finding. Continuing with a fabricated empty config
    // would report every published package as absent from a group that could not be read.
    findings.push({
      file: configPath,
      detail: 'Changeset config could not be parsed as JSON, so the fixed group could not be read.',
    });
    return findings;
  }

  const groups = config?.fixed;
  if (
    !Array.isArray(groups) ||
    groups.some((group) => !Array.isArray(group) || group.some((name) => typeof name !== 'string'))
  ) {
    findings.push({
      file: configPath,
      detail: 'Changeset config must declare "fixed" as an array of package-name groups.',
    });
    return findings;
  }

  const packagesDir = path.join(workspaceRoot, 'packages');
  if (!existsSync(packagesDir)) {
    findings.push({
      file: 'packages',
      detail: 'No packages/ directory, so the published package set could not be derived.',
    });
    return findings;
  }

  const publishedNames = new Set();
  let manifestsUnreadable = false;
  for (const packageDir of listManifestPackageDirs(workspaceRoot)) {
    const manifestPath = path.join(packageDir, 'package.json');
    const relativeManifestPath = path
      .relative(workspaceRoot, manifestPath)
      .split(path.sep)
      .join('/');
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      // allow-fallback: an unreadable manifest is reported, never skipped — skipping it would turn
      // "we could not tell" into "this package is not published".
      manifestsUnreadable = true;
      findings.push({
        file: relativeManifestPath,
        detail: 'Package manifest could not be read, so the published package set is incomplete.',
      });
      continue;
    }
    if (manifest?.private !== true && typeof manifest?.name === 'string') {
      publishedNames.add(manifest.name);
    }
  }

  // Direction 1: group ⊆ published.
  const groupIndexByName = new Map();
  groups.forEach((group, groupIndex) => {
    for (const name of group) {
      if (groupIndexByName.has(name)) {
        findings.push({
          file: configPath,
          detail: `Fixed group entry "${name}" appears in more than one group.`,
        });
        continue;
      }
      groupIndexByName.set(name, groupIndex);
      // An incomplete published set cannot support an ABSENCE claim: with a manifest unread, the
      // name might be published by exactly the package that could not be parsed.
      if (!manifestsUnreadable && !publishedNames.has(name)) {
        findings.push({
          file: configPath,
          detail: `Fixed group entry "${name}" names no published workspace package.`,
        });
      }
    }
  });

  // Direction 2: published ⊆ group, and direction 3: all in ONE group.
  const groupsHoldingPublished = new Set();
  for (const name of [...publishedNames].sort()) {
    if (!groupIndexByName.has(name)) {
      findings.push({
        file: configPath,
        detail: `Published package "${name}" is not in the changeset fixed group.`,
      });
      continue;
    }
    groupsHoldingPublished.add(groupIndexByName.get(name));
  }
  if (groupsHoldingPublished.size > 1) {
    findings.push({
      file: configPath,
      detail: `Published packages are split across ${groupsHoldingPublished.size} fixed groups; version-management rule 4 requires one.`,
    });
  }

  return findings;
}
