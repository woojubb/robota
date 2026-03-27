/**
 * Hook: fetch data for PluginTUI screens.
 * Extracted from PluginTUI.tsx for single-responsibility.
 */

import { useState, useEffect } from 'react';
import type { IPluginCallbacks } from '../../commands/slash-executor.js';
import type { IMenuSelectItem } from '../MenuSelect.js';

export function usePluginScreenData(
  screen: string,
  marketplace: string | undefined,
  callbacks: IPluginCallbacks,
  refreshCounter: number,
  stackLength: number,
): { items: IMenuSelectItem[]; loading: boolean; error: string | undefined } {
  const [items, setItems] = useState<IMenuSelectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setItems([]);
    setError(undefined);

    if (screen === 'marketplace-list') {
      setLoading(true);
      callbacks
        .marketplaceList()
        .then((sources) => {
          const baseItems: IMenuSelectItem[] = [{ label: 'Add Marketplace', value: '__add__' }];
          const sourceItems: IMenuSelectItem[] = sources.map((s) => ({
            label: s.name,
            value: s.name,
            hint: s.type,
          }));
          setItems([...baseItems, ...sourceItems]);
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    } else if (screen === 'marketplace-browse') {
      const mp = marketplace ?? '';
      setLoading(true);
      callbacks
        .listAvailablePlugins(mp)
        .then((plugins) => {
          setItems(
            plugins.map((p) => ({
              label: p.name,
              value: p.name,
              hint: p.installed ? 'installed' : p.description,
            })),
          );
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    } else if (screen === 'installed-list') {
      setLoading(true);
      callbacks
        .listInstalled()
        .then((plugins) => {
          setItems(
            plugins.map((p) => ({
              label: p.name,
              value: p.name,
              hint: p.description,
            })),
          );
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }
  }, [stackLength, screen, marketplace, callbacks, refreshCounter]);

  return { items, loading, error };
}
