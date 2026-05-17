interface IParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function compareSemverVersions(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (parsedLeft === undefined || parsedRight === undefined) {
    return Math.sign(left.localeCompare(right));
  }

  const coreCompare =
    compareNumber(parsedLeft.major, parsedRight.major) ||
    compareNumber(parsedLeft.minor, parsedRight.minor) ||
    compareNumber(parsedLeft.patch, parsedRight.patch);
  if (coreCompare !== 0) {
    return coreCompare;
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

export function isNewerSemverVersion(candidate: string, current: string): boolean {
  return compareSemverVersions(candidate, current) > 0;
}

function parseSemver(value: string): IParsedSemver | undefined {
  const normalized = value.trim().replace(/^v/, '').split('+')[0] ?? '';
  const [core, prereleaseText] = normalized.split('-', 2);
  const [majorText, minorText, patchText] = core.split('.');
  const major = parseNumericIdentifier(majorText);
  const minor = parseNumericIdentifier(minorText);
  const patch = parseNumericIdentifier(patchText);
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }
  return {
    major,
    minor,
    patch,
    prerelease: prereleaseText ? prereleaseText.split('.') : [],
  };
}

function parseNumericIdentifier(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

function compareNumber(left: number, right: number): number {
  return Math.sign(left - right);
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    const partCompare = comparePrereleaseIdentifier(leftPart, rightPart);
    if (partCompare !== 0) {
      return partCompare;
    }
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumber = parseNumericIdentifier(left);
  const rightNumber = parseNumericIdentifier(right);
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return compareNumber(leftNumber, rightNumber);
  }
  if (leftNumber !== undefined) {
    return -1;
  }
  if (rightNumber !== undefined) {
    return 1;
  }
  return Math.sign(left.localeCompare(right));
}
