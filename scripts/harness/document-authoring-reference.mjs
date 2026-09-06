/**
 * INFRA-143 — apply the canonical reference-kind predicate before a governed document is written.
 *
 * The tree scan is the independent integration floor. This module is the earlier authoring
 * boundary: it deliberately delegates all parsing and exemptions to `reference-kind.mjs`, so a
 * writer cannot create a new document that is known to fail the later scan.
 */

import { unqualifiedReferences } from './reference-kind.mjs';

/**
 * Return the authoring findings for one prospective document.
 *
 * `file` is kept in the result even when the caller is rendering a dry run: the diagnostic must
 * point at the document that would have been created, not merely at the generator that noticed it.
 */
export function findDocumentAuthoringReferenceFindings({ file, text }) {
  return unqualifiedReferences(text).map((finding) => ({ file, ...finding }));
}

/** Format the fail-closed diagnostic shared by every document-authoring entry point. */
export function documentAuthoringReferenceError({ file, text }) {
  const findings = findDocumentAuthoringReferenceFindings({ file, text });
  if (findings.length === 0) return null;

  const details = findings
    .map(({ line, number, text: excerpt }) => `    ${file}:${line}  #${number}  ${excerpt}`)
    .join('\n');
  return (
    `document authoring refused: ${file} contains ${findings.length} bare GitHub reference(s) ` +
    'before completion. Qualify each reference as `issue #N` or `PR #N` (or use the documented ' +
    'closing-keyword form).\n' +
    details
  );
}
