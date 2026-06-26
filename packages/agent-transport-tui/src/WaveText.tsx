/**
 * WaveText — renders text with a subtle wave color animation.
 * Groups of 3-4 characters share the same color, creating a soft flowing effect.
 * Colors stay in a narrow range (dim grays) to avoid harsh contrast.
 */

import { Text } from 'ink';
import React, { useState, useEffect } from 'react';

// Subtle gray tones — minimal contrast, soft wave
const WAVE_COLORS = ['#666666', '#888888', '#aaaaaa', '#888888'] as const;
const INTERVAL_MS = 400;
const CHARS_PER_GROUP = 4;

interface IProps {
  text: string;
}

/**
 * Animate only on an interactive color terminal. In a non-TTY (piped/redirected
 * output) or when NO_COLOR is set, render static text — no interval, no
 * flicker, no motion (SCREEN-006 accessibility / non-TTY safety).
 */
function shouldAnimate(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

export default function WaveText({ text }: IProps): React.ReactElement {
  const animate = shouldAnimate();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!animate) return undefined;
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [animate]);

  if (!animate) {
    return <Text color={WAVE_COLORS[2]}>{text}</Text>;
  }

  const chars = [...text];

  return (
    <Text>
      {chars.map((char, i) => {
        const group = Math.floor(i / CHARS_PER_GROUP);
        const colorIndex = (tick + group) % WAVE_COLORS.length;
        return (
          <Text key={i} color={WAVE_COLORS[colorIndex]}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}
