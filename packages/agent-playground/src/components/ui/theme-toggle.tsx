'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

type ThemeMode = 'light' | 'dark' | 'system';

function applyTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;

  root.classList.remove('dark');

  if (mode === 'dark' || (mode === 'system' && prefersDark)) {
    root.classList.add('dark');
  }
}

export function ThemeToggle() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => applyTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => applyTheme('dark')}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => applyTheme('system')}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
