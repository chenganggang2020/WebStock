# ADR-002: Use public one-minute bars with a local thirty-second view

## Status

Accepted

## Date

2026-08-15

## Context

The original intraday chart used a five-minute public feed. The user needs a faster free view on Windows and mobile, but does not require paid Level-2 or large-order data. Free provider endpoints can fail or change, and quote polling must not be presented as exchange tick-by-tick evidence.

## Decision

- `GET /api/minute?code=<six-digit-code>` uses Tencent public one-minute data first, Eastmoney public one-minute data second, and the existing Sina five-minute feed only as a declared fallback.
- `GET /api/minute?code=<code>&resolution=30s` returns persistent local bars aggregated from the existing public Level-1 quote snapshots.
- The selected stock checks for updates every three seconds during the China trading session. Existing server-side request coalescing, timeouts and provider throttling remain in force.
- Every response reports its provider, sampling interval, trading date, stale/market state and whether it is derived. The thirty-second response explicitly sets `derived=true`, `exchangeGroundTruth=false` and `realtimeGuaranteed=false`.
- Missing quote observations remain null. The system does not interpolate trades, synthesize volume or call the thirty-second view Level-2 data.

## Alternatives Considered

### Reading a logged-in mobile stock application or emulator

Rejected because it depends on private UI behavior, login state and possible platform restrictions. It is less stable and less auditable than a bounded public-data adapter.

### Polling a public quote endpoint every second

Rejected because a faster local timer does not make the upstream source faster and would increase failure/rate-limit risk. The UI may read local snapshots every second, while the upstream quote refresh remains bounded at three seconds.

### Labeling local quote aggregation as tick or Level-2 data

Rejected because the source has neither exchange tick completeness nor Level-2 order detail.

## Consequences

- The default chart is materially finer than the previous five-minute view, with an automatic five-minute fallback during one-minute provider outages.
- The local thirty-second history starts accumulating only after this version runs during a trading session; it cannot reconstruct earlier observations.
- Free sources do not guarantee uninterrupted real-time delivery. The UI must continue to show fallback, latest-close, stale and unavailable states instead of silently substituting data.
- Stored thirty-second bars are retained with the local database and increase its size over time.
