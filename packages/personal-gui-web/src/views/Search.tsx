import { useState } from 'react';

import { Button, Notice, ViewFrame, errorText, inputClass } from './ui.js';

import type { IPersonalApi, ISearchResult } from '../api.js';

/** One search over what the agent keeps; a result opens its page in the library. */
export function SearchView({
  api,
  onOpenPage,
}: {
  readonly api: IPersonalApi;
  readonly onOpenPage: (pageId: string) => void;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly ISearchResult[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <ViewFrame title="Search">
      <form
        role="search"
        className="flex max-w-2xl gap-2 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            setResults(await api.search(query));
            setError(undefined);
          } catch (caught) {
            setError(errorText(caught));
          }
        }}
      >
        <input
          type="search"
          aria-label="Search"
          placeholder="People, places, plans, preferences…"
          className={inputClass}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          required
        />
        <Button type="submit" tone="primary">
          Search
        </Button>
      </form>
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {results !== undefined && results.length === 0 && <Notice>Nothing matches.</Notice>}
      {results !== undefined && results.length > 0 && (
        <ul className="flex max-w-2xl flex-col gap-2 px-4 pb-4">
          {results.map((result) => (
            <li key={result.page.id}>
              <button
                type="button"
                onClick={() => onOpenPage(result.page.id)}
                className="w-full rounded-lg border border-border p-3 text-left hover:bg-hover"
              >
                <div className="text-[14px] font-medium">{result.page.title}</div>
                <div className="text-[12.5px] text-muted-foreground">{result.page.kind}</div>
                {result.matches.map((match) => (
                  <p key={match} className="mt-1 text-[13px]">
                    {match}
                  </p>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ViewFrame>
  );
}
