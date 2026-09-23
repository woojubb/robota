/**
 * SCREEN-2002 — colour-vision-deficiency simulation, for the guard over the daltonized built-ins.
 *
 * A daltonized theme's claim is that two colours a viewer must tell apart still differ AFTER their
 * protan or deutan confusion. That is measurable, so it is measured: simulate both deficiencies
 * (Viénot–Brettel–Mollon, the linear-RGB projection published for dichromats), convert to CIE Lab,
 * and take the pairwise distance.
 *
 * The guard REFUSES what it cannot simulate. A colour NAME is whatever the terminal says it is, so a
 * named value in a daltonized theme is an error rather than a pass — the one direction a guard may
 * never take silently.
 */
import type { TThemeColor } from './theme-contracts.js';

export type TColorVision = 'protanopia' | 'deuteranopia';

interface IRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX_LONG = /^#([0-9a-f]{6})$/iu;
const HEX_SHORT = /^#([0-9a-f]{3})$/iu;
const ANSI256 = /^ansi256\((\d{1,3})\)$/iu;
const RGB = /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/iu;
const BYTE_MAX = 255;
const HEX_BASE = 16;
const HEX_PAIR = /[0-9a-f]{2}/giu;
const ANSI_CUBE_START = 16;
const ANSI_GRAY_START = 232;
const ANSI_CUBE_SIDE = 6;
/**
 * Published numeric tables are kept as DATA — parsed from their published text rather than spelled
 * as literals in expressions, so the values stay verbatim and reviewable against their source.
 */
function coefficients(published: string): number[] {
  return published.split(/\s+/u).map(Number);
}

/** The xterm 6×6×6 cube's channel levels. */
const ANSI_CUBE_STEPS = coefficients('0 95 135 175 215 255');
const GRAY_STEP = 10;
const GRAY_BASE = 8;

/** An Ink-grammar colour as 0–255 sRGB, or `undefined` when it cannot be simulated. */
export function toRgb(color: TThemeColor): IRgb | undefined {
  const long = HEX_LONG.exec(color);
  if (long?.[1]) {
    const [r, g, b] = (long[1].match(HEX_PAIR) ?? []).map((pair) =>
      Number.parseInt(pair, HEX_BASE),
    ) as [number, number, number];
    return { r, g, b };
  }
  const short = HEX_SHORT.exec(color);
  if (short?.[1]) {
    const [r, g, b] = [...short[1]].map((digit) => Number.parseInt(`${digit}${digit}`, HEX_BASE));
    return r === undefined || g === undefined || b === undefined ? undefined : { r, g, b };
  }
  const rgb = RGB.exec(color);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  const ansi = ANSI256.exec(color);
  if (ansi) return fromAnsi256(Number(ansi[1]));
  // A colour NAME resolves in the terminal, not here.
  return undefined;
}

function fromAnsi256(index: number): IRgb | undefined {
  if (index >= ANSI_GRAY_START) {
    const level = GRAY_BASE + (index - ANSI_GRAY_START) * GRAY_STEP;
    return { r: level, g: level, b: level };
  }
  if (index < ANSI_CUBE_START) return undefined; // the 16 system colours are terminal-defined
  const offset = index - ANSI_CUBE_START;
  const r = ANSI_CUBE_STEPS[Math.floor(offset / (ANSI_CUBE_SIDE * ANSI_CUBE_SIDE))];
  const g = ANSI_CUBE_STEPS[Math.floor(offset / ANSI_CUBE_SIDE) % ANSI_CUBE_SIDE];
  const b = ANSI_CUBE_STEPS[offset % ANSI_CUBE_SIDE];
  return r === undefined || g === undefined || b === undefined ? undefined : { r, g, b };
}

const GAMMA_THRESHOLD = 0.04045;
const GAMMA_OFFSET = 0.055;
const GAMMA_SCALE = 1.055;
const GAMMA_EXPONENT = 2.4;
const GAMMA_LINEAR_DIVISOR = 12.92;

function toLinear(channel: number): number {
  const value = channel / BYTE_MAX;
  return value <= GAMMA_THRESHOLD
    ? value / GAMMA_LINEAR_DIVISOR
    : ((value + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA_EXPONENT;
}

/** Viénot–Brettel–Mollon dichromat projections, applied in linear RGB. */
const PROJECTION: Record<TColorVision, readonly number[][]> = {
  protanopia: [
    coefficients('0.1121 0.8853 -0.0005'),
    coefficients('0.1127 0.8897 -0.0001'),
    coefficients('0.0045 0.0 1.0019'),
  ],
  deuteranopia: [
    coefficients('0.292 0.7054 -0.0003'),
    coefficients('0.2934 0.7089 0.0'),
    coefficients('-0.0209 0.4614 0.5677'),
  ],
};

/** sRGB → CIE XYZ (D65), the standard matrix. */
const SRGB_TO_XYZ = [
  coefficients('0.4124 0.3576 0.1805'),
  coefficients('0.2126 0.7152 0.0722'),
  coefficients('0.0193 0.1192 0.9505'),
];

function project(matrix: readonly number[][], vector: readonly number[]): number[] {
  return matrix.map((row) =>
    row.reduce((sum, factor, index) => sum + factor * (vector[index] ?? 0), 0),
  );
}

interface ILab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

const D65 = coefficients('0.95047 1 1.08883');
const LAB_EPSILON_NUMERATOR = 216;
const LAB_EPSILON_DENOMINATOR = 24389;
const LAB_KAPPA_DIVISOR = 27;
const LAB_EPSILON = LAB_EPSILON_NUMERATOR / LAB_EPSILON_DENOMINATOR;
const LAB_KAPPA = LAB_EPSILON_DENOMINATOR / LAB_KAPPA_DIVISOR;
const LAB_L_SCALE = 116;
const LAB_L_OFFSET = 16;
const LAB_A_SCALE = 500;
const LAB_B_SCALE = 200;
const THREE = 3;
const CUBE_ROOT = 1 / THREE;

function toLab(linear: readonly number[]): ILab {
  const xyz = project(SRGB_TO_XYZ, linear).map((value, index) => value / (D65[index] ?? 1));
  const f = (value: number): number =>
    value > LAB_EPSILON ? value ** CUBE_ROOT : (LAB_KAPPA * value + LAB_L_OFFSET) / LAB_L_SCALE;
  const [fx, fy, fz] = xyz.map(f) as [number, number, number];
  return {
    l: LAB_L_SCALE * fy - LAB_L_OFFSET,
    a: LAB_A_SCALE * (fx - fy),
    b: LAB_B_SCALE * (fy - fz),
  };
}

/** One colour as a dichromat sees it, in Lab. `undefined` ⇒ the value cannot be simulated. */
export function simulate(color: TThemeColor, vision: TColorVision): ILab | undefined {
  const rgb = toRgb(color);
  if (rgb === undefined) return undefined;
  const linear = [toLinear(rgb.r), toLinear(rgb.g), toLinear(rgb.b)];
  return toLab(project(PROJECTION[vision], linear));
}

/** CIE76 distance between two simulated colours; `undefined` when either cannot be simulated. */
export function simulatedDistance(
  first: TThemeColor,
  second: TThemeColor,
  vision: TColorVision,
): number | undefined {
  const a = simulate(first, vision);
  const b = simulate(second, vision);
  if (a === undefined || b === undefined) return undefined;
  const SQUARE = 2;
  return Math.sqrt((a.l - b.l) ** SQUARE + (a.a - b.a) ** SQUARE + (a.b - b.b) ** SQUARE);
}
