# ADR-007: Keep native reader and media work off the GUI critical path

Status: Accepted for the Windows performance repair, 2026-10-16.

## Evidence and scope

`output/native-stress-audit-20261016/REPORT.md` reproduces research opening at 2.6 seconds, selection rebuilding 990 items, video teardown at 0.24 seconds and watch filtering at 0.09 seconds. This repair changes those paths only. Original stores, IDs, raw records, receipts, CAS, quote semantics and collection scheduling remain unchanged.

## Decision

- Create the industry workspace and company editor when their tab is entered. Generate the history catalog on a single background worker using the existing complete read-only validation; do not replace it with a weaker integrity check. Coalesce overlapping reloads and preserve selected versions. Watchers owned by the page prevent use-after-destruction callbacks.
- Keep evidence-list projection in memory for search; refresh it asynchronously on return. Never replace editor fields during list refresh. Save/open still recheck the original record.
- Selecting a work only loads its reader. Saving and changing the underlying library may still rebuild its list. Failed draft navigation restores the selected ID with signals blocked.
- Text filtering shares the validated watchlist-directory projection already used by quote repainting. Explicit group/roster/edit paths continue rebuilding that projection.
- Each Windows video session owns all MFPlay/COM calls in one MTA worker, including creation, commands, state reads and shutdown. The UI sends bounded/coalesced commands and reads a small snapshot. At retirement, invalidate UI generation, clear queued commands and hide/detach the native child HWND. The worker stops playback and releases the original read lock, then schedules destruction of that child on its creator UI thread. No external player is started. A two-worker limit accommodates one retiring decoder and one newly opening decoder.

## Alternatives and trade-offs

Removing archive integrity checks would sacrifice correctness. Moving only `Shutdown` with an un-marshaled UI-thread COM pointer would violate apartment ownership. A UI timer merely postpones the same freeze. All were rejected. The dedicated player worker is a small internal lifecycle component, not a new media framework.

List refresh and video commands are asynchronous; the UI must wait for actual completion, not assume a queued request has finished. A missing/changed record still prevents playback or saving. Decoder capabilities and genuine online collection are not proven by these tests.

Microsoft references: [Media Foundation and COM](https://learn.microsoft.com/en-us/windows/win32/medfound/media-foundation-and-com), [MFPlay callbacks and playback](https://learn.microsoft.com/en-us/windows/win32/medfound/getting-started-with-mfplay).

## Verification

See `output/native-performance-fix-20261016/`: failing-before tests, focused regression, unchanged stress workload and deployment receipt. Original audit evidence remains untouched. No new database schema, dependencies, external service calls or old-task activation.
