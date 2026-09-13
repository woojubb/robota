/**
 * WaveText — renders text with a subtle wave color animation.
 * Groups of 3-4 characters share the same color, creating a soft flowing effect.
 * Ramp and cadence come from the shared MOTION tokens (SCREEN-006): a calm gray span
 * wide enough to be perceptible (#555→#bbb) at an unhurried 400ms cadence.
 */

import React, { useState, useEffect } from 'react';

import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { isInteractiveColorTerminal } from './terminal-capabilities.js';
import { MOTION, PALETTE } from './tui-palette.js';

interface IProps {
  text: string;
}

export default function WaveText({ text }: IProps): React.ReactElement {
  // Animate only on an interactive color terminal (shared with the markdown color
  // gate via terminal-capabilities). Non-TTY / NO_COLOR / FORCE_COLOR=0 → static,
  // no interval, no motion (SCREEN-006/008).
  //
  // CLI-2004: screen-reader mode is a THIRD gate on the same interval, not a second mechanism. A
  // colour ramp is silent to a reader, but the repaint it causes is not — every tick re-emits the
  // line, and the reader announces it again.
  const screenReader = useScreenReader();
  const animate = isInteractiveColorTerminal() && !screenReader;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!animate) return undefined;
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, MOTION.waveIntervalMs);
    return () => clearInterval(timer);
  }, [animate]);

  if (screenReader) {
    // No colour prop at all: the mode drops the cue rather than substituting a value.
    return <Text>{text}</Text>;
  }

  if (!animate) {
    return <Text color={PALETTE.text.muted}>{text}</Text>;
  }

  const chars = [...text];

  return (
    <Text>
      {chars.map((char, i) => {
        const group = Math.floor(i / MOTION.waveCharsPerGroup);
        const colorIndex = (tick + group) % MOTION.waveColors.length;
        return (
          <Text key={i} color={MOTION.waveColors[colorIndex]}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}
