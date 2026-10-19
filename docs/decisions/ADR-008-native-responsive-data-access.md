# ADR-008: Keep SQLite; separate UI response from data work

Status: **Accepted**, 2026-10-16. User selected route B. P01/P02/P03 were verified and deployed (3/8); P04–P08 remain incomplete. See the numbered plan and per-batch deployment receipts for scope and exact evidence.

## Context

The installed Windows Stock still freezes during navigation. The follow-up [diagnosis](../../output/native-hang-followup-20261016/REPORT.md) captured a GUI-thread SQLite lock wait caused by a hidden funds-page subscriber. Independent isolation also proved redundant theme propagation, and real-backup tests identified synchronous full reads on cold page entry. These are distinct issues; they do not prove SQLite is unsuitable or that every Store is slow.

ADR-007 addressed narrower reader/media paths. Its accepted changes remain; this proposal extends coverage without rewriting those working paths.

## Decision

Adopt route B in [the detailed comparison and numbered plan](../../native/PERFORMANCE-ARCHITECTURE-PLAN.md):

- Retain Qt, existing SQLite domains, raw JSON, Parquet and external media. No schema, server or journal-mode migration in the first implementation.
- Move expensive reads, parsing and validation off the GUI path with bounded admission, thread-owned read-only connections, consistent snapshots and stale-result rejection.
- Update only visible, relevant consumers; coalesce repaint notifications, not historical observations or explicit durable operations.
- Reapply theme only when it changes or a new page needs initialization. Keep page-local drafts and navigation configuration.
- Use exact-ID details and lightweight list projections. Preserve current integrity-check semantics; no unproven validation shortcut.
- P03 now exposes a single validated securities snapshot, builds catalogs/search results off the UI thread and renders 100 rows per page. Data-reload and search generations are distinct; a query change can reuse the accepted dataset, explicit reload cannot. It shares a two-thread read pool with funds while bounding each page to one running and one latest pending request. Injected callbacks must not access GUI objects.
- Measure write backlog before optimization; retain durable saves and explicit completion semantics. Do not treat an enqueued save as committed.
- Gate deployment on real-data navigation plus concurrent writes/lock tests, not empty-menu smoke tests alone.

## Alternatives

Only patching two call sites is a useful first batch but leaves cold-page and queue problems. A database/UI rewrite has disproportionate migration risk and does not inherently remove GUI work. WAL may improve concurrency but does not address theme costs, parsing or queue growth; its version, backup, checkpoint and multi-database implications require a separate measured decision.

Commercial comparisons are drawn from public TradingView SDK, MetaTrader, Sierra Chart and historical Tonghuashun manuals linked in the plan. They are not claims about undisclosed proprietary internals.

## Consequences and acceptance

Asynchronous results need identity, generation, lifetime and draft protection. Bounded queues need explicit admission and failure states. Source freshness and save status stay honest. P01–P08 each retain failure-before/fix-after evidence, with tests and installed-package proof separate. No original databases, media, receipts, old packages or deferred services are replaced by this document.

## Measured text-layout supplement (2026-10-16, not deployed)

The final discovery-page audit found two separate costs beyond database access:

- A complete 4,200,692-byte single-line import stalls both direct insertion and a background-prepared QTextDocument handed to the GUI. The latter still relayouts on adoption. Use a page-specific complete text buffer with bounded, explicitly labeled editable segments instead; preview, persistence, export and undo operate on the complete source. Preserve existing Qt plain-text normalization and the initial external raw-byte preview. No global editor replacement or source truncation.
- In a fresh process, the first emoji fallback causes Qt 6.9.1 to populate all installed font-family metadata. A small text reproduces approximately 270ms GUI work; an explicit font chain merely moves that cost into setFont. A continuous background loop also failed because it monopolized Qt's shared font-database lock (approximately 1054ms GUI gap). Do not disable font merging, drop characters or prewarm only the test.

The accepted next implementation is a real startup preparation step using the thread-safe public QFontDatabase API: bounded background batches release the font lock and yield through GUI checkpoints. Only after preparation succeeds may normal Window initialization begin. Closing preparation interrupts the worker; an active GUI must not block waiting for it, and QApplication must outlive the worker. The read-only --check-data-root path remains before this preparation and creates no window or automatic task.

The isolated cooperative prototype measured 449.041ms total preparation, 53.9328ms maximum GUI gap, and 84.2335ms maximum subsequent first-character/full-input notification. Cancellation completed the worker approximately 18.4621ms after the request. These are prototype evidence, not deployed or whole-application acceptance. The production helper and exact startup path must be tested and included in the final binding; startup cost must be reported separately, never subtracted from UI measurements. All original failures remain in output/native-responsive-rest-20261016/p05-market/large-import-text.
