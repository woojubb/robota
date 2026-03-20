/**
 * WaveText — renders text with a wave color animation.
 * Each character cycles through colors with an offset, creating a flowing wave effect.
 */

import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

const WAVE_COLORS = ['gray', 'white', 'cyan', 'white', 'gray', 'dim'] as const;
const INTERVAL_MS = 150;

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
        const colorIndex = (tick + i) % WAVE_COLORS.length;
        const color = WAVE_COLORS[colorIndex];
        if (color === 'dim') {
          return (
            <Text key={i} dimColor>
              {char}
            </Text>
          );
        }
        return (
          <Text key={i} color={color}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}
