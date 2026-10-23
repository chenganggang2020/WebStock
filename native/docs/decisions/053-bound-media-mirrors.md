# ADR 053: Restore bounded official media mirrors and explicit source retry

2026-10-18. In progress; separate from the installed round-3 binary.

Evidence: the legacy douyinTranscriptService.js loops through allowedMediaUrls;
native douyin-snapshot.js currently returns only the first extracted address.
Round-3 Stock completed four real videos but five Ellie works returned CDN 403.
That does not prove every rejected work has a usable alternative.

Scope:

1. Retain at most eight unique, allowed HTTPS URLs from one exact work/author
   detail response. Never take an unbound DOM player URL or invent a host.
2. On 403/404/410 only, try the next supplied mirror once, within the same
   120-second total deadline. Each reply still passes all host, redirect, type,
   size, MP4 and hash checks. No retry through login, challenge, unsafe redirect,
   invalid content or cancellation. No credentials or security configuration.
3. An explicit retry of an empty, failed source job reopens its exact detail and
   checks its unchanged record before updating media metadata and enqueueing.
   Automatic plans still skip held jobs; no bulk revival or manual-text overwrite.
4. Test before replacing Stock, then verify new bytes, ASR and DB receipts via
   the normal program. Preserve preceding binaries and all existing data.

Verification: snapshot binding, persisted metadata, controlled denied-first /
good-second download, bad mirror/redirect/cancel cases, stale/cancelled explicit
source retry; actual affected author/failed work. No repeated stress test.
