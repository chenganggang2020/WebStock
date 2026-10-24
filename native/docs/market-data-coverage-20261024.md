# Native market data coverage changes · 2026-10-24

## Futures daily changes

The two primary readings are CITIC Futures and all disclosed institutions:
`daily long-position change - daily short-position change`, summed across every
disclosed contract in IF, IH, IC and IM. A positive value means a net movement
toward long; a negative value means a net movement toward short. The raw long
and short changes remain alongside the result, since reducing shorts can also
produce a positive net change. Selecting a detail contract does not change the
headline totals.

The institutional total includes CITIC and covers the published top-20 ranked
positions only, not the entire market. CITIC requires comparable disclosures
on both sides; missing daily changes propagate unknown values. Coverage counts
and missing sides remain explicit. A four-product request replaces the visible
batch only after all products validate for the same disclosure date. Failure or
cancellation preserves the previous complete batch. Notifications are deduplicated
by raw content, including transitions between a full batch and one product.

Desktop archive saves are atomic for a whole batch within existing archive limits.
Android preserves the entire reading state, but its archive action still explicitly
saves the current product only.

Live public CFFEX responses for 2026-10-23 contained IF 4, IH 3, IC 3 and IM 4
contracts. The 14 contracts/840 raw ranking rows produced CITIC
`14,277 - 10,463 = +3,814` and institutions `36,788 - 36,775 = +13`.
The old JavaScript summary functions produced the same results from those responses.
Model missing-value boundaries, batch failure/cancellation, archive capacity,
unchanged totals on contract selection, notification deduplication, and desktop
wide/narrow native page rendering passed focused checks.

## Historical visible/dark flow

Known market closures no longer consume the source-failure budget during history
backfill. Unknown calendar periods are not inferred. The chart reports the actual
available model-date coverage, with a control to focus the available records.
Missing dates stay missing; the price candle span is not presented as money-flow
coverage. Android also distinguishes available daily data from saved intraday
archives. Existing focused coverage and National Day backfill tests passed.

## ETF daily rankings

The Eastmoney article for data day 2026-10-22 (article 202610233904868678) exposes
only three subscriptions and three redemptions in its structured body. Its official
image publishes ten of each. The default desktop page now shows both complete
framed ranking images side by side. Unknown source layouts fall back to displaying
the entire original image. The original clickable body entries remain in a
secondary tab. Android defaults to the full original image with scrolling and
enlargement, retaining the body entries as a secondary view.

This is the complete **published ranking**, not a full-market ETF dataset. Image
rows are not OCR-derived numeric records and cannot be sorted/exported or opened
as additional instrument links. Source date and article update state are unchanged
by image loading. Failed image requests do not report a successful daily-data
update. Requests are bounded, restricted to the existing public image allowlist,
and guarded against late responses after a date change or cancellation.

The actual 429,228-byte image (1000 × 3362) was freshly retrieved and verified.
Two affected desktop page checks passed, including both ranking panels through
the tenth row at 1550 × 960 and 1000 × 760. Android passed 28 focused host checks
and compilation of 264 production / 185 test Java units. Android device UI,
BitmapFactory execution, actual Android network requests and APK installation
remain unverified; compilation is not device acceptance.

## Delivery boundary

Desktop candidate was built and replaced using an isolated preview profile.
Holdings, groups and related ETF/futures files were backed up and hash-checked
through replacement. Existing external schedules were not resumed and G:/Stock
was not written. Private profiles, backups, source captures, screenshots and Word
reports remain local under ignored output directories; this commit contains code,
tests and this change note only. Unrelated passing suites were not rerun.
