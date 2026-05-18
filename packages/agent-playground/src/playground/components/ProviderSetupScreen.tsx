'use client';

import React, { useState } from 'react';
import { ChevronDown, Key } from 'lucide-react';

import { Button } from '../../components/ui/button';
import type { IProviderConfig, TProviderName } from '../../hooks/use-provider-config';

type TProviderSetupScreenProps = {
  onConnect: (config: IProviderConfig) => void;
};

const PROVIDERS: Array<{ id: TProviderName; label: string; placeholder: string }> = [
  { id: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
  { id: 'openai', label: 'OpenAI (GPT)', placeholder: 'sk-...' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza...' },
  { id: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
];

function ProviderSelect({
  value,
  onChange,
}: {
  value: TProviderName;
  onChange: (v: TProviderName) => void;
}): React.ReactElement {
  return (
    <div className="relative">
      <select
        className="w-full appearance-none border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary pr-8"
        value={value}
        onChange={(e) => onChange(e.target.value as TProviderName)}
      >
        {PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}

export function ProviderSetupScreen({ onConnect }: TProviderSetupScreenProps): React.ReactElement {
  const [provider, setProvider] = useState<TProviderName>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  const selectedProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  const handleConnect = () => {
    const key = apiKey.trim();
    if (!key) {
      setError('API key is required');
      return;
    }
    setError('');
    onConnect({ provider, apiKey: key });
  };

  return (
    <div className="w-full h-full min-h-[60vh] flex items-center justify-center bg-background">
      <div className="flex flex-col gap-4 max-w-sm w-full px-6">
        <div className="flex items-center gap-2 mb-2">
          <Key className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Connect your AI provider</h2>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Your API key is stored locally in your browser and never logged on the server.
        </p>
        <div className="flex flex-col gap-3">
          <ProviderSelect value={provider} onChange={setProvider} />
          <input
            type="password"
            className="border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            placeholder={selectedProvider.placeholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            autoComplete="off"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button onClick={handleConnect} size="sm" className="w-full">
            Connect
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-1">
          No server running?{' '}
          <code className="font-mono bg-muted px-1 rounded">npx @robota-sdk/agent-cli serve</code>
        </p>
      </div>
    </div>
  );
}
