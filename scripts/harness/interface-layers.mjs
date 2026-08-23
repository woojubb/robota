/**
 * ARCH-101 (issue #2180) — the declared layer of each `agent-interface-*` package, and the one
 * predicate that decides whether an edge between two of them is legal.
 *
 * ## The rule this encodes
 *
 * The owner ruled that the general layer rule governs this prefix: a package may compose another with
 * the same prefix **when the layers differ and the composition is one-directional**. Only SAME-LAYER
 * is forbidden — and an upward edge is forbidden by the same sentence, because "one-directional"
 * fixes which way the composition runs.
 *
 * The Interface Package Rule previously said `deps ⊆ {agent-core}`, i.e. the interface layer had to be
 * EDGELESS. That was an exact proxy for the property while one package held every contract family;
 * decomposing into six owners (ARCH-100) makes the proxy an over-approximation that forbids the target
 * graph. Edgelessness is replaced here by the direct property.
 *
 * ## Why this file exists rather than the check living in either guard
 *
 * TWO guards need the same answer at different altitudes: `checkInterfacePackageDeps` judges MANIFEST
 * edges (`package.json` dependencies) and `interface-family-owner` judges MODULE edges (imports
 * between contract files). If each parsed the declaration itself, one fact would have two parsers that
 * can disagree about it — which is the duplication class this repository keeps paying for, and which
 * ARCH-100's owner map was built to avoid. The document coupling is accepted ONCE, here.
 *
 * ## What it does NOT decide
 *
 * Which package belongs in which layer. That assignment is ARCH-100's, declared in
 * `.agents/specs/contract-family-owner-map.md`, and this module only reads it. A package absent from
 * the declaration has NO layer, and an edge touching it is `unknown` rather than legal — a caller that
 * treats "no layer declared" as permission has re-created the vacuous green this pair of guards exists
 * to refuse.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LAYER_DOC = path.join(ROOT, '.agents/specs/contract-family-owner-map.md');
const MARKER = '<!-- arch-101:layer-map -->';

/**
 * Parse the layer table. PURE over the document text.
 *
 * @returns {{layers: Map<string, number>, missingMarker: boolean}} `layers` keys are bare package
 *   names (`agent-interface-session`), not npm specifiers — callers normalise.
 */
export function parseLayerDeclaration(docText) {
  const layers = new Map();
  const at = docText.indexOf(MARKER);
  if (at === -1) return { layers, missingMarker: true };

  // Bounded to the ONE table after the marker. An unbounded read would absorb a later example row as
  // a real declaration and nothing would say so — the same fail-open the owner-map parser was fixed
  // for in HARNESS-116.
  let started = false;
  for (const line of docText.slice(at).split('\n')) {
    const isRow = /^\s*\|/.test(line);
    if (started && !isRow) break;
    if (isRow) started = true;
    const m = line.match(/^\|\s*(\d+)\s*\|\s*`(agent-interface-[a-z-]+)`\s*\|/);
    if (m) layers.set(m[2], Number(m[1]));
  }
  return { layers, missingMarker: false };
}

/** Strip an npm scope so a scoped specifier and the bare name compare equal. */
export function bareName(pkg) {
  return pkg.replace(/^@[^/]+\//, '');
}

/** Read the declaration from the repository. Throws rather than returning an empty legal-by-default map. */
export function readInterfaceLayers(docPath = LAYER_DOC) {
  if (!existsSync(docPath)) {
    throw new Error(`interface-layers: cannot read ${path.relative(ROOT, docPath)}`);
  }
  const { layers, missingMarker } = parseLayerDeclaration(readFileSync(docPath, 'utf8'));
  if (missingMarker) {
    throw new Error(
      `interface-layers: ${path.relative(ROOT, docPath)} has no ${MARKER} marker. The layer ` +
        `declaration is what authorizes every interface→interface edge; without it there is nothing ` +
        `to check, and a guard that passes because it found no input is the defect it exists to refuse.`,
    );
  }
  return layers;
}

/** Is this an `agent-interface-*` package? */
export function isInterfacePackage(pkg) {
  return bareName(pkg).startsWith('agent-interface-');
}

/**
 * Judge one interface→interface edge against the declaration.
 *
 * @returns {{legal: boolean, reason: 'downward'|'same-layer'|'upward'|'undeclared', from?: number, to?: number, missing?: string[]}}
 */
export function judgeEdge(from, to, layers) {
  const a = layers.get(bareName(from));
  const b = layers.get(bareName(to));
  if (a === undefined || b === undefined) {
    return {
      legal: false,
      reason: 'undeclared',
      missing: [
        a === undefined ? bareName(from) : null,
        b === undefined ? bareName(to) : null,
      ].filter(Boolean),
    };
  }
  if (a === b) return { legal: false, reason: 'same-layer', from: a, to: b };
  if (a < b) return { legal: false, reason: 'upward', from: a, to: b };
  return { legal: true, reason: 'downward', from: a, to: b };
}

/** The failure sentence for an illegal edge, in the vocabulary the rule uses. */
export function explainEdge(from, to, verdict) {
  const f = bareName(from);
  const t = bareName(to);
  switch (verdict.reason) {
    case 'same-layer':
      return `${f} → ${t} is a SAME-LAYER dependency (both layer ${verdict.from}). Interface packages compose only across differing layers; move one, or the types they share belong in one package.`;
    case 'upward':
      return `${f} (layer ${verdict.from}) → ${t} (layer ${verdict.to}) runs UPWARD. Composition is one-directional: a lower layer never names a higher one.`;
    case 'undeclared':
      return `${f} → ${t} cannot be judged: ${verdict.missing.join(' and ')} ${verdict.missing.length > 1 ? 'have' : 'has'} no declared layer in .agents/specs/contract-family-owner-map.md. Declare the layer; an undeclared package is not legal by default.`;
    default:
      return `${f} → ${t} is legal (layer ${verdict.from} → ${verdict.to}).`;
  }
}
