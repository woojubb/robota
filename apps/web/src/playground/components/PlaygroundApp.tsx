'use client';

import React from 'react';
import { WorkflowView } from '@/workflow';

export function PlaygroundApp(): JSX.Element {
  return (
    <div className="w-full h-full min-h-[60vh] flex flex-col">
      <header className="px-4 py-2 border-b">
        <h1 className="text-lg font-semibold">Playground</h1>
        <p className="text-sm text-muted-foreground">Interactive workflow visualization and controls</p>
      </header>
      <main className="flex-1 overflow-auto">
        <WorkflowView />
      </main>
    </div>
  );
}


