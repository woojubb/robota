/**
 * Plugin-related slash command handlers.
 * Extracted from slash-executor.ts for single-responsibility.
 */

import type { TAddMessage, IPluginCallbacks, ISlashResult } from './slash-executor.js';

export async function handlePluginCommand(
  args: string,
  addMessage: TAddMessage,
  callbacks: IPluginCallbacks,
): Promise<ISlashResult> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0] ?? '';
  const subArgs = parts.slice(1).join(' ').trim();

  try {
    switch (subcommand) {
      case '':
      case undefined:
      case 'manage': {
        return { handled: true, triggerPluginTUI: true };
      }
      case 'install': {
        if (!subArgs) {
          addMessage({ role: 'system', content: 'Usage: /plugin install <name>@<marketplace>' });
          return { handled: true };
        }
        await callbacks.install(subArgs);
        addMessage({ role: 'system', content: `Installed plugin: ${subArgs}` });
        return { handled: true };
      }
      case 'uninstall': {
        if (!subArgs) {
          addMessage({ role: 'system', content: 'Usage: /plugin uninstall <name>@<marketplace>' });
          return { handled: true };
        }
        await callbacks.uninstall(subArgs);
        addMessage({ role: 'system', content: `Uninstalled plugin: ${subArgs}` });
        return { handled: true };
      }
      case 'enable': {
        if (!subArgs) {
          addMessage({ role: 'system', content: 'Usage: /plugin enable <name>@<marketplace>' });
          return { handled: true };
        }
        await callbacks.enable(subArgs);
        addMessage({ role: 'system', content: `Enabled plugin: ${subArgs}` });
        return { handled: true };
      }
      case 'disable': {
        if (!subArgs) {
          addMessage({ role: 'system', content: 'Usage: /plugin disable <name>@<marketplace>' });
          return { handled: true };
        }
        await callbacks.disable(subArgs);
        addMessage({ role: 'system', content: `Disabled plugin: ${subArgs}` });
        return { handled: true };
      }
      case 'marketplace': {
        return handleMarketplaceSubcommand(subArgs, addMessage, callbacks);
      }
      default:
        addMessage({ role: 'system', content: `Unknown plugin subcommand: ${subcommand}` });
        return { handled: true };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    addMessage({ role: 'system', content: `Plugin error: ${message}` });
    return { handled: true };
  }
}

async function handleMarketplaceSubcommand(
  subArgs: string,
  addMessage: TAddMessage,
  callbacks: IPluginCallbacks,
): Promise<ISlashResult> {
  const mpParts = subArgs.split(/\s+/);
  const mpSubcommand = mpParts[0] ?? '';
  const mpArgs = mpParts.slice(1).join(' ').trim();

  if (mpSubcommand === 'add' && mpArgs) {
    const registeredName = await callbacks.marketplaceAdd(mpArgs);
    addMessage({
      role: 'system',
      content: `Added marketplace: "${registeredName}" (from ${mpArgs})\nInstall plugins with: /plugin install <name>@${registeredName}`,
    });
    return { handled: true };
  } else if (mpSubcommand === 'remove' && mpArgs) {
    await callbacks.marketplaceRemove(mpArgs);
    addMessage({
      role: 'system',
      content: `Removed marketplace "${mpArgs}" and uninstalled its plugins.`,
    });
    return { handled: true };
  } else if (mpSubcommand === 'update' && mpArgs) {
    await callbacks.marketplaceUpdate(mpArgs);
    addMessage({
      role: 'system',
      content: `Updated marketplace "${mpArgs}".`,
    });
    return { handled: true };
  } else if (mpSubcommand === 'list') {
    const sources = await callbacks.marketplaceList();
    if (sources.length === 0) {
      addMessage({ role: 'system', content: 'No marketplace sources configured.' });
    } else {
      const lines = sources.map((s) => `  ${s.name} (${s.type})`);
      addMessage({ role: 'system', content: `Marketplace sources:\n${lines.join('\n')}` });
    }
    return { handled: true };
  } else {
    addMessage({
      role: 'system',
      content: 'Usage: /plugin marketplace add <source> | remove <name> | update <name> | list',
    });
    return { handled: true };
  }
}

export async function handleReloadPlugins(
  addMessage: TAddMessage,
  callbacks: IPluginCallbacks,
): Promise<ISlashResult> {
  await callbacks.reloadPlugins();
  addMessage({ role: 'system', content: 'Plugins reload complete.' });
  return { handled: true };
}
