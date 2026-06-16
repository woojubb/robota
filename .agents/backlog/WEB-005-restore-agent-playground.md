---
title: 'Restore Agent Playground references on apps/www'
status: todo
---

# Restore Agent Playground references on apps/www

## What

Re-enable the Agent Playground references on the marketing site (`apps/www`) once the
hosted playground (`play.robota.io`) actually ships. They were temporarily hidden before
the pre-launch copy review because the playground is not yet live.

## Why

Linking to and showcasing a product that is not yet reachable hurts credibility on a
launch site. The references were removed/commented out rather than deleted so they can be
restored verbatim when the playground goes live.

## Hidden references (restore these)

1. **Footer link** — `apps/www/src/components/Footer.tsx`
   - The `<a href="https://play.robota.io">…{t('footer.links.playground')} ↗</a>` block is
     commented out (marker comment cites this backlog ID). Uncomment to restore.
   - The `common.footer.links.playground` key still exists in `en.json` / `ko.json` and is
     unused while the link is commented out — no change needed there.

2. **Showcase project** — `apps/www/src/messages/en.json` and `ko.json`
   - The `showcase.projects[]` entry **"Visual Agent Builder Playground"** was removed from
     both locale files. Re-add it (en + ko) with matching highlights:
     `Browser-based SDK usage`, `SSE streaming`, `Multi-provider BYOK`, `Code export`
     (Korean: `브라우저 기반 SDK 사용`, `SSE 스트리밍`, `멀티 프로바이더 BYOK`, `코드 내보내기`).

## Done When

- `play.robota.io` is live and reachable.
- Footer playground link is uncommented and renders.
- Showcase lists the Visual Agent Builder Playground project again (en + ko parity).
- `pnpm --filter robota-www build` passes.

## User Execution Test Scenarios

1. Visit the deployed site footer → the Playground link appears and opens the live playground.
2. Visit `/showcase` → the Visual Agent Builder Playground card is listed in both EN and KO.
