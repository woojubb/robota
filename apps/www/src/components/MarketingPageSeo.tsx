import { getMarketingPageGraph, marketingPath, type MarketingLocale, type MarketingPage } from '../lib/marketing';
import en from '../messages/seo/en.json';
import ko from '../messages/seo/ko.json';

/** Static JSON-LD and a matching visible breadcrumb; no browser execution is needed. */
export function MarketingPageSeo({ locale, page }: { locale: MarketingLocale; page: MarketingPage }) {
  const graph = getMarketingPageGraph(locale, page);
  if (!graph) return null;
  const breadcrumb = graph['@graph'].find((node) => node['@type'] === 'BreadcrumbList');
  const items = breadcrumb && 'itemListElement' in breadcrumb ? breadcrumb.itemListElement : undefined;
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</gu, '\\u003c') }} />
    {items && <nav className="site-breadcrumb" aria-label={(locale === 'ko' ? ko : en).breadcrumb}>
      <ol>
        <li><a href={marketingPath(locale)}>{items[0].name}</a></li>
        <li aria-current="page">{items[1].name}</li>
      </ol>
    </nav>}
  </>;
}
