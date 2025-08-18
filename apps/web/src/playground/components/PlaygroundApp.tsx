'use client';

import React from 'react';
import { WorkflowView } from '@/workflow';
import { usePlayground } from '../hooks/usePlayground';

export function PlaygroundApp(): JSX.Element {
  const { ready } = usePlayground();
  return (
    <div className="w-full h-full min-h-[60vh] flex flex-col">
      <header className="px-4 py-2 border-b">
        <h1 className="text-lg font-semibold">Playground</h1>
        <p className="text-sm text-muted-foreground">Interactive workflow visualization and controls</p>
      </header>
      <main className="flex-1 overflow-auto">
        {ready ? <WorkflowView /> : (
          <div className="p-4 text-sm text-muted-foreground">Initializing playground...</div>
        )}
      </main>
    </div>
  );
}


