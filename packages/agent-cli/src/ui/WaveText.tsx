/**
 * WaveText — renders text with a subtle wave color animation.
 * Groups of 3-4 characters share the same color, creating a soft flowing effect.
 * Colors stay in a narrow range (dim grays) to avoid harsh contrast.
 */

import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

// Subtle gray tones — minimal contrast, soft wave
const WAVE_COLORS = ['#666666', '#888888', '#aaaaaa', '#888888'] as const;
const INTERVAL_MS = 200;
const CHARS_PER_GROUP = 4;

interface IProps {
  text: string;
}

export default function WaveText({ text }: IProps): React.ReactElement {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

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
