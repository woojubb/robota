import React from 'react';
import { writeFileSync } from 'node:fs';
import { render, useApp } from 'ink';
import ProviderSetupPrompt from '../../ProviderSetupPrompt.js';
import type { TProviderSetupType } from '../../../utils/provider-setup-flow.js';

const [, , outputPath, rawType] = process.argv;

if (!outputPath || (rawType !== 'openai' && rawType !== 'anthropic')) {
  process.stderr.write('Usage: provider-setup-prompt-driver <output-path> <openai|anthropic>\n');
  process.exit(1);
}

function Driver({ type }: { type: TProviderSetupType }): React.ReactElement {
  const { exit } = useApp();
  return (
    <ProviderSetupPrompt
      type={type}
      onSubmit={(input) => {
        writeFileSync(outputPath, JSON.stringify(input), 'utf8');
        exit();
        setTimeout(() => process.exit(0), 0);
      }}
      onCancel={() => {
        exit();
        setTimeout(() => process.exit(2), 0);
      }}
    />
  );
}

render(<Driver type={rawType} />);
