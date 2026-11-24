import { useEffect, useState } from 'react';

import { newestFirst, offerSource, offerTitle } from './offer-text.js';
import { Button, when } from './ui.js';

import type { IPersonalApi, ITaskOfferView } from '../api.js';

/** How many suggestions the Feed shows at once; Browse has the rest. */
export const OFFERS_IN_FEED = 3;

/** How often the Feed asks again what is suggested: slower than its own list, since suggestions come rarely. */
export const OFFERS_REFRESH_MS = 30_000;

/**
 * What the agent suggests, as plain entries at the end of the Feed. They are read from the agent's
 * offers, newest first and at most a few, and they only say what is suggested and why: opening one
 * takes the person to its card in Browse, where the decision is made. An entry never starts a task and
 * never interrupts. When the offers cannot be read the Feed shows nothing for them, and keeps the last
 * ones it read.
 */
export function OfferFeedEntries({
  api,
  onOpenOffer,
}: {
  readonly api: IPersonalApi;
  /** Opens the offer's card in Browse. */
  readonly onOpenOffer: (offerId: string) => void;
}): React.ReactElement | null {
  const [offers, setOffers] = useState<readonly ITaskOfferView[]>([]);
  useEffect(() => {
    let current = true;
    const read = async (): Promise<void> => {
      try {
        const listing = await api.taskOffers();
        // An offer that was started is no longer a suggestion; one set aside is not in this list.
        if (current) setOffers(listing.offers.filter((offer) => offer.decision === 'open'));
      } catch {
        // allow-fallback: suggestions are an extra on the Feed, so a failed read shows nothing for them.
      }
    };
    void read();
    const timer = setInterval(() => void read(), OFFERS_REFRESH_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [api]);
  const shown = newestFirst(offers).slice(0, OFFERS_IN_FEED);
  if (shown.length === 0) return null;
  return (
    <ul aria-label="Suggested tasks" className="flex max-w-3xl flex-col gap-2 px-4 pb-4">
      {shown.map((offer) => (
        <li key={offer.id} className="rounded-lg border border-border p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-medium uppercase tracking-wide text-subtle">
              Suggestion
            </span>
            <h2 className="text-[14px] font-semibold">{`Suggested task: ${offerTitle(offer)}`}</h2>
            <span className="ml-auto text-[12px] text-muted-foreground">
              {when(offer.createdAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[14px]">{offer.reason}</p>
          <p className="mt-1 break-words text-[12.5px] text-muted-foreground">
            {offerSource(offer)}
          </p>
          <div className="mt-2">
            <Button onClick={() => onOpenOffer(offer.id)}>Open suggestion</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
