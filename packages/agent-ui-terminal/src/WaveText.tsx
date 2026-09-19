/**
 * WaveText — renders text with a subtle wave color animation.
 * Groups of 3-4 characters share the same color, creating a soft flowing effect.
 * The ramp comes from the resolved theme's motion tokens (SCREEN-006, SCREEN-2002): a calm span
 * wide enough to be perceptible (#555→#bbb) at an unhurried 400ms cadence.
 */

import React, { useState, useEffect } from 'react';

import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { useMotion, useMotionTokens, usePalette } from './theme/index.js';

/** Cadence is not themed: a theme changes colour, not how often the terminal repaints. */
const MOTION_INTERVAL_MS = 400;
const MOTION_CHARS_PER_GROUP = 4;

interface IProps {
  text: string;
}

export default function WaveText({ text }: IProps): React.ReactElement {
  // Animate only on an interactive color terminal (shared with the markdown color
  // gate via terminal-capabilities). Non-TTY / NO_COLOR / FORCE_COLOR=0 → static,
  // no interval, no motion (SCREEN-006/008).
  //
  // CLI-2004: screen-reader mode is a gate on the same interval, not a second mechanism. A colour
  // ramp is silent to a reader, but the repaint it causes is not — every tick re-emits the line, and
  // the reader announces it again. SCREEN-2002 added `reducedMotion` as a third input to that rule.
  const screenReader = useScreenReader();
  const palette = usePalette();
  const motionTokens = useMotionTokens();
  // SCREEN-2002: the colour gate, screen-reader mode and the reduced-motion setting are ONE rule
  // with one owner. This is its only consumer — the package's only animation.
  const animate = useMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!animate) return undefined;
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, MOTION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [animate]);

  if (screenReader) {
    // No colour prop at all: the mode drops the cue rather than substituting a value.
    return <Text>{text}</Text>;
  }

  if (!animate) {
    return <Text color={palette.text.muted}>{text}</Text>;
  }

  const chars = [...text];

  return (
    <Text>
      {chars.map((char, i) => {
        const group = Math.floor(i / MOTION_CHARS_PER_GROUP);
        const colorIndex = (tick + group) % motionTokens.wave.length;
        return (
          <Text key={i} color={motionTokens.wave[colorIndex]}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}
