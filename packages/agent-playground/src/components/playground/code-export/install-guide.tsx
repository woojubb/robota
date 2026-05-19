'use client';

import React from 'react';
import { Terminal } from 'lucide-react';

const INSTALL_COMMAND =
  'npm install @robota-sdk/agent-core @robota-sdk/agent-provider @robota-sdk/agent-tools';

export function InstallGuide() {
  return (
    <div className="border-t border-border mt-4 pt-4">
      <div className="flex items-center gap-2 mb-2">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Install dependencies</span>
      </div>
      <pre className="text-xs font-mono text-green-400 bg-black/40 rounded px-3 py-2 overflow-x-auto">
        {INSTALL_COMMAND}
      </pre>
    </div>
  );
}
