/**
 * Hook: create a CommandRegistry once with builtin and skill commands.
 */

import { useRef } from 'react';
import { CommandRegistry } from '../../commands/command-registry.js';
import { BuiltinCommandSource } from '../../commands/builtin-source.js';
import { SkillCommandSource } from '../../commands/skill-source.js';

export function useCommandRegistry(cwd: string): CommandRegistry {
  const registryRef = useRef<CommandRegistry | null>(null);
  if (registryRef.current === null) {
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());
    registry.addSource(new SkillCommandSource(cwd));
    registryRef.current = registry;
  }
  return registryRef.current;
}
