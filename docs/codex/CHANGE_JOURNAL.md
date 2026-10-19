# Change Journal

## 2026-10-19 — Fixed-geometry and cross-page chart audit requested

- User's installed-window screenshots show loading/ready and different symbols shifting chart/readout geometry. Static review confirms data-dependent axisWidth, empty-paint early returns, content-driven labels, separate GlobalPlot drag behavior and selected-point reset on refresh. No runtime code change or installed-window replay is claimed in this audit step.
- Added docs/review/STOCK-UI-AUDIT-20261019.md with UI01–UI10, evidence levels, fixed frame/data-state separation, market-aware shared viewport interaction and concrete geometry/lifecycle acceptance criteria. Native Qt/Java is the current product; root Electron source is legacy comparison, not the installed executable.
- User authorized a source-only GitHub snapshot and review in their named existing ChatGPT conversation. Preserve checkout/index, data/media/login material and backups; publish on an isolated review branch, not main. Exclude production data/screenshots and generated binaries. Tool-access failure must remain an explicit pending review, not a fabricated external result.

## 2026-10-19 — Q01–Q06 chart and visible-market refresh repair deployed

- Fixed explicit-qfq monthly history rejection and the dependent yearly chart path without changing source prices or default raw-transaction validation. Fixed seconds loading/completion/cancel state and old-save acknowledgements overwriting newer requests; existing viewport survives state-only updates.
- Comparison/board/ETF/futures visible pages now sustain nonoverlapping automatic updates, back off on failure and preserve historical readers. Automatic ETF updates do not prune saved observations; unchanged futures updates do not duplicate history. Exact-symbol single-source Tencent index history includes today's forming bar, with honest Sina fallback and older-series refusal.
- Five affected top action regions use a small wrapping layout, preserving all controls and permanent main/submenu navigation. Focused checks:13 calendar,2 race,8 current-index,18 refresh,18 geometry; Qt suites5 feed/5 actual host/11 market data/10 refresh/4 Tencent host/6 old history/8 overview, counts include setup/cleanup where applicable. Four real monthly responses and eight live index histories checked; screenshots inspected. Not all-feature/manual/ARM or30-minute acceptance.
- Built1267 native inputs with zero build-time hash differences; installed EXE8F0A402AD328FBF5A1BFB4D2FA8279F7F1A9E4FDD36E1607B4D36A0AF68A5ED6. Normally closed Stock under explicit authorization, backed up old EXE and27 DB/settings files;10767 original data files SHA unchanged. Independent57-program-file ZIP verified. G:/Stock/data retained; old jobs/paused stress test not started.
- Evidence: output/native-q01-q06-20261019/REVIEW.md and installed-verification.json. Q01–Q06 progress6/6; other project progress is not implied.

## 2026-10-17 — E3 working-set corrections accepted, final acceptance pending

- E2's actual combined-host stalls and memory growth remain failed evidence. Scoped changes now retain only backup choice metadata and the selected company profile, move eligible collection polling to bounded thread-owned reads, reuse the unchanged date regex per thread, and retain market-overview list metadata with selected complete detail. No schema, FULL/CAS/receipt, raw original or historical-ID semantics were relaxed.
- Full 4.2MB overview import exposed a separate 180s text layout stall; existing complete-buffer/32KiB editor projection now serves this page too. Private 12 lightweight and7 text body checks pass, including edit-during-preview cancellation, invalid restore preserving drafts, and same-page CAS conflicts. These are not unified app acceptance.
- Root verified31 packages/5519 inputs; one historical external pointer resolved to identical frozen bytes rather than changing its expected hash. First unified build's invalid const-char-pointer label addition remains preserved; only explicit QString typing changed, independently reviewed. The new unified build, backup Window and four fresh final suites remain required before Stock deployment. Installed3/8 and formal data untouched at this checkpoint.

## 2026-10-16 — P03 single snapshot, background search and bounded rendering deployed

- Actual Window on the previous immutable data backup blocked2771.45ms opening business search. Three full Store loads plus catalog merge, search and all-row widget creation ran on GUI. Preserved original RED log.
- Kept original complete Store validation in one Snapshot API; moved catalog/search to bounded shared reader pool, separated reload/query generations, preserved failed/hidden/destroyed callbacks and original selection. GUI now displays100 rows/page without truncating6998 total results. Shared two-reader pool also serves P01 funds; no schema, journal mode, data, network or old-task changes.
- P03 final7 business cases+init/cleanup=9 pass; shared queue1+2=3 pass; affected funds5+2=7 pass; navigation4+2=6 pass. Real cold10.6418ms; complete results1843.22ms;60 warm round trips p9535.0485ms, max36.1866ms, heartbeat103.595ms. 200 existing funds/menu switches p9589.6802ms, maximum96.5062ms. Failed test premises and launcher error retained in report; did not weaken runtime validation, fuzzy search or timing thresholds.
- Source diff reviewed across correctness/readability/architecture/security/performance; screenshot and shared-library identity checked. 1156 build inputs: runtime unchanged after app build, only test source evolved; final manifest reconciled. Installed EXE `EBBF73322F300E9280A5C9F7A305A3D4EC9E1371D9463930607420F4DB7C8010` at `D:/Stock/Stock.exe` after closed-process check,10736-file independent backup and pre/post data SHA zero differences. Old program retained `D:/Stock/Stock.before-responsive-20261016T0710008147Z.exe`. Ordinary window/old tasks not launched.
- Evidence: `output/native-responsive-p03-20261016/REPORT.md`, `verification.json`, `deployment-summary.json`. Progress3/8. NextP04: person method versions, backup catalog, quant/material cold paths; P05–P08 remain. No claim of all64 real-data capacity,30-minute soak, ARM, real provider collection or global absence of UI stalls.

## 2026-10-16 — Route B first batch P01/P02 implemented and deployed

- User approved B and confirmed normal Stock exit. Preserved existing source/data and original evidence; no schema or journal-mode changes, no old jobs, no real credentials or quant edits.
- Reproduced hidden funds locking (885.552ms), 5s-lock entry (5002.73ms), theme propagation (341.986ms/1559 events) and navigation widget recreation before fixing. Funds uses background read-only snapshots with target/generation/lifetime guards; latest feed data is used independently of the main quote coalescer. Theme/nav updates now depend on actual changes.
- Final focused 12, Store 10 and navigation 6 tests passed, counts include init/cleanup. 200 real-backup warm menu switches p95 92.114ms/max134.179ms, heartbeat max158.08ms; 5s-lock funds entry13.4676ms and heartbeat31.4902ms. New snapshots preserve raw data, source dates, history/replay and configuration/drafts.
- Intermediate fixture, assertion, compilation and wait-premise failures are preserved and explained in `output/native-responsive-design-20261016/REPORT.md`; tests were not substituted for production/data acceptance.
- Program replaced only after 10736-file data backup and matching before/after SHA. New installed SHA `B5379916D0A4094EF8729AD9A62752289B5FC02B092C3CAE2A208BFF16B180F0`; prior EXE retained as `D:/Stock/Stock.before-responsive-20261016T0628294317Z.exe`, full data backup in the new deployment directory. Ordinary window/old tasks not launched.
- Progress is 2/8, not global completion. Next P03 validated directory/profile snapshot and P04 cold-page preparation; P05/P06 queue/detail work and P07/P08 final combined acceptance remain.

## 2026-10-16 — Native responsiveness design before implementation

Status: proposed design only; no runtime source, production database, installed EXE or automation changed.

- Compared official TradingView Advanced Charts, MetaTrader 5, Sierra Chart and historical Tonghuashun documentation with current native code and the preserved menu-hang evidence. Public contracts are distinguished from unknown proprietary implementation.
- Proposed retaining Qt/SQLite, first fixing hidden funds-page SQL and unchanged-theme propagation, then snapshot reuse, cold-page work, bounded persistence and selective list/chart updates. P01–P08 have explicit acceptance and deployment states in `native/PERFORMANCE-ARCHITECTURE-PLAN.md`.
- Added proposed ADR-008; marked the August project context as legacy so its Electron/companion topology is not mistaken for current native Stock.
- Existing defect-reproduction results are a baseline, not proof of a fix. This turn performs documentation/link and whitespace checks only; runtime tests and package replacement require the subsequent implementation.
- Preserve unrelated quant edits, original data/media, durable validation, receipts and all frozen packages. Await review of route B before changing runtime behavior.

## 2026-08-11 - Permanent Douyin Archive, Incremental Planning And AI Packets

### Decision

- Treat the local database, transcript and completed media archive as durable research evidence. A remote deletion or unavailable page changes only remote availability; it never cascades into local deletion.
- Establish a complete public-visible work index first, persist every discovered batch, then use stable material fingerprints, age-based refresh and exponential retry backoff for incremental detail collection.
- Generate clean AI handoff packets by recent count, date range or all records, with exact ASR text preferred and page-visible text explicitly labeled as a non-transcript fallback.

### Implementation

- Added resumable profile scrolling with per-batch import, persistent scan checkpoints, a 400-scroll safety ceiling and fair detail scheduling for new, stale, retry and transcription-pending records.
- Added permanent `WebStockData/media-library/douyin/<contentId>.mp4` archives with atomic `.part` downloads, SHA-256/size/MIME evidence and local reuse when the remote media URL is gone. Startup cleanup now removes only stale `.part` files.
- Read the original Douyin detail response through Electron's debugger before navigation completes; media candidates remain in memory only and are filtered by content ID, HTTPS CDN host and historical evidence before download.
- Bound ordinary scheduled archive recovery to two exact-size mirrors. Explicit complete scans may try up to twelve exact mirrors plus twenty-four de-duplicated renditions, but every file still requires the historical SHA-256 before atomic publication.
- Persist archive evidence before ASR starts, so a later recognition failure cannot orphan a completed local video.
- Added a dedicated AI packet panel and API for recent/date/all selection. Packets exclude signed media URLs, local paths and generated investment conclusions, and never silently truncate.

### Evidence

- Independent final review found no Blocking or Important issues after original-response timing, candidate truncation and scheduled-traffic corrections.
- Node regression: 202/202 passed; browser regression: 10/10 passed; quant regression: 29/29 passed.
- Live historical backfill recovered 14/14 MP4 files (103,087,385 bytes). Every file matches the prior size and SHA-256; 14/14 transcripts and ASR objects remained byte-for-byte unchanged, with zero completed-file deletion and zero `.part` residue.
- The live observation rows and sync results contain zero signed media URLs. The before/after transcript-plus-ASR digest is `8B6357A6D6F0CADDFEC42DD3011858E664152CD66259C2A91E1A06B54D96ED65`.
- Isolated final portable smoke returned HTTP 200 and exposed the packaged network-route, pipeline, run-history, complete-scan and AI-packet controls.
- Final installer: 128,362,966 bytes, SHA-256 `4A9D6B663492856F4A719A7932A38C7831FC266FCDC3435CF2C22514E5F6CA03`.
- Final portable EXE: 116,308,957 bytes, SHA-256 `FADCF8B2180DA0D61A6836697D269911D439AF80934F1E784412D2CE659FD1D1`.
- The verified post-backfill database snapshot is `dist/rollback/20260811-after-verified-archive-backfill/webstock.db`, SHA-256 `572F564BADDE9AA911CEAF8E55DDB9A911B4093FF11F0393B3F46A23C69DDCE8`.

### Remaining Boundary

- “Complete” means all works visible to the current authenticated public profile session and DOM; the application does not bypass login, CAPTCHA, private visibility or platform risk controls.
- The all-record AI packet fails explicitly above 5,000 records or 25 MB and asks for a time split; it never silently omits records.
- The authenticated public profile reported 368 works but stabilized at 56 currently visible cards during the live scan. The 14 known historical downloads are fully recovered; the remaining public-work baseline still advances incrementally and does not claim full 368-item coverage.

## 2026-08-11 - Truthful Douyin Run Audit And Transcription States

### Decision

- Separate `主页总作品`, `本轮页面加载` and `本地抖音作品`; none of these counts may stand in for another.
- Do not call an item `待转写` unless the local ASR path has actually been reached. Distinguish detail pending, media inspection, download, transcription, media missing, per-run deferral, failure and unverified legacy state.
- Persist bounded UI history for collection runs and per-video stages without persisting signed media URLs or downloaded video files.

### Implementation

- Added `expert_sync_runs` and `expert_sync_run_items`, a recent-runs API, batched history loading and expandable per-video audit rows.
- Added download/transcription progress callbacks, explicit `media_missing` observation metadata and managed startup cleanup for ASR temporary files older than six hours.
- Revised the collection pipeline and video filters so missing or legacy evidence is not presented as a real transcription queue.

### Evidence

- Node regression: 163/163 passed; browser regression: 10/10 passed; quant regression: 29/29 passed.
- Official npm registry audit reported 0 known vulnerabilities.
- Frozen portable smoke returned HTTP 200, exposed the run-history API, created both audit tables, and contained the expected sync/UI/schema modules with no tests, database, `.venv`, quant workspace or ASR temporary files in `app.asar`.
- The isolated smoke left the formal portable database byte-identical. The restarted final portable returned HTTP 200 and removed one stale 4.8 MB managed ASR temporary file.
- Final installer: 128,350,692 bytes, SHA-256 `A6498C37BBA76CFCE49EAAC2CBCFEB7E029D24743C15733CD1ED2A1ACD819FCE`.
- Final portable EXE: 116,301,537 bytes, SHA-256 `5DAF65EC961D2AC40C78C016177A90A9209475E4CDF62BD2DEF0276A7D2B705A`.
- Previous binaries are recoverable from `dist/rollback/20260811-184000-before-run-audit`.

### Remaining Boundary

- Existing historical observations without ASR metadata or a run audit are labeled `转写条件待核验`; detailed audit rows begin with the next collection run and are not retroactively invented.

## 2026-08-11 - Dedicated Collection Tasks And Visible Network Route

### Decision

- Keep general people, books and methods management in AI Research, but move Douyin collection controls and video review into a dedicated `采集任务` view.
- Persist the current collection stage separately from the last completed result so an active run can show real progress without overwriting its prior evidence summary.
- Report the route resolved by Electron's persistent Douyin session. This distinguishes proxy from direct traffic; WebStock does not override the proxy application's own per-domain routing rules.

### Implementation

- Added a fixed-height, split video list/detail workbench with compact rows, filters and narrow-screen fallbacks.
- Added the five-stage flow `会话检查 -> 主页发现 -> 详情采集 -> 本地转写 -> 保存入库` and live progress polling while a manual run is active.
- Added `expert_sync_jobs.progress_json`, the `webstock:douyin-network-route` desktop bridge and an Electron proxy-route inspector.

### Evidence

- Node regression: 160/160 passed.
- Browser regression: 10/10 passed, including 1300 x 800 non-overlap assertions and the existing 390 px dark-mode flow.
- Quant regression: 29/29 passed.
- Final portable smoke returned HTTP 200, loaded 28 video rows from the existing portable data, resolved `快车 / 系统代理 · 127.0.0.1:7891`, and had no document-level horizontal overflow.
- Final installer SHA-256: `1C7232183EC23F5BAB4FC332C0E8F7E49C795766D0D3B534BF6E5A911CA2E19B`.
- Final portable SHA-256: `BFEC2A24A5D96D6089DCF6E8B9A6A0CE650CB1A6F05F001100145815C1F69CD2`.
- Visual artifacts: `output/playwright/creator-tasks-source.png` and `output/playwright/creator-tasks-final-portable.png`.
- Rollback copies of the prior binaries are under `dist/rollback/20260811-162632-before-collection-ui`.

### Remaining Boundary

- A resolved local proxy such as `127.0.0.1:7891` proves that Electron sends the request to that proxy. Whether the proxy then selects a remote node or `DIRECT` remains controlled by the proxy application's active rules.

## 2026-08-09 23:30 - Packaged Android Host And LAN Safety

### Decision

- Make phone access an explicit Windows Settings action rather than requiring `npm run start:android` from a source checkout.
- Keep ordinary desktop/web startup loopback-only. A non-loopback listener is allowed only while a valid pairing token is active.

### Implementation

- Added persistent per-data-directory LAN preferences and pairing tokens, an Electron server controller, a sandboxed preload bridge and the `手机连接（安卓）` Settings card.
- Enabling phone access rebinds the same Express application to `0.0.0.0`, lists only private/shared IPv4 pairing URLs and protects remote requests with the existing token-to-cookie middleware. Disabling immediately returns to `127.0.0.1`.
- Source `npm start` now binds to loopback by default; `npm run start:android` remains a development fallback and reuses the same host/token helpers.

### Evidence

- Node regression: 98/98 passed; quant regression: 20/20 passed; browser regression: 5/5 passed; official npm registry audit: 0 vulnerabilities.
- Electron integration test opened Settings, enabled LAN access, observed an unpaired 401, exchanged the complete URL for an HttpOnly/SameSite cookie, disabled LAN access and confirmed the remote address disconnected.

### Remaining Boundary

- Android remains a companion to a running Windows host on a trusted network. It is not a standalone data/model server, and no broker execution path was added.

## 2026-08-09 15:00 - AI Research Platform Takeover

Status: phase A delivered; phase B pending traceable historical data and isolated Python runtime

Problem:
- The referenced design mixed six external platforms/models and did not define which capabilities were actually deployed, how data/model provenance would be recorded, or how the existing WebStock application should integrate them.
- WebStock already contains a local factor screener and ChatGPT handoff, but lacks a source-grounded expert knowledge base and a truthful model capability registry.

Reasoning:
- Qlib is suitable as an optional research sidecar, while RD-Agent currently requires Linux/Docker and LLM/embedding services.
- MASTER's official repository documents dependency and validation-data caveats, so it cannot replace a simple baseline without same-data evaluation.
- The first deliverable should run locally on Windows without paid API access and preserve the existing desktop data path.

Change direction:
- Add an SQLite-backed expert knowledge base with Chinese fuzzy retrieval and stable evidence IDs.
- Reuse the existing ChatGPT handoff and optional OpenAI provider.
- Add a model registry that distinguishes available, configured, not configured, planned and unavailable states.
- Keep real trading disabled and postpone heavyweight Python runtimes to isolated adapters.

Affected files/modules:
- `docs/ai-research/AI_PLATFORM_DESIGN.md`
- `db/init.sql`: expert sources, stable evidence chunks, FTS5 index and research runs.
- `services/knowledgeService.js`, `services/researchRunService.js`, `services/modelRegistryService.js`.
- `routes/aiResearch.js`: source, search, evidence analysis, model status and research-run APIs.
- `js/modules/aiResearch.js`, `index.html`, `css/styles.css`: desktop and narrow-screen research workspace.
- `services/backupService.js`, `js/modules/settings.js`: version 2 backup and restore coverage.
- `js/modules/stockScreener.js`: filtered all-market candidates can enter expert evidence review.
- Unit, API, backup and Playwright regression tests.

Verification:
- Baseline `npm test`: 47/47 passed before implementation.
- Final `npm test`: 56/56 passed.
- `npm run test:frontend`: 5/5 passed, including source creation, evidence retrieval, ChatGPT handoff save and screener-to-expert review.
- `npm run test:portfolio`: passed.
- `npm run test:api-json`: passed.
- Desktop and 390 px visual checks completed; browser console had no warnings or errors.
- `npm run dist:win:all`: installer and portable packages built successfully.
- Isolated portable EXE smoke: Electron ready and local server listening on port 3000.
- Portable user DB remained byte-identical after packaging and retained 34 trade records.

Follow-ups:
- Phase B requires a licensed or otherwise traceable point-in-time daily dataset before a Qlib/LightGBM rolling backtest can be accepted.
- MASTER and agent frameworks remain visibly `planned`; they must not be marked available until same-data out-of-sample tests pass.

## 2026-08-09 18:20 - Reproducible Qlib/LightGBM Baseline

Status: phase B exploratory implementation delivered; formal data validation pending

Problem:
- WebStock had no executable model-training contract, no isolated Python runtime, and no way to distinguish a completed exploratory run from a validated strategy.
- Public daily data can demonstrate the workflow but cannot support formal claims because current-list membership, historical ST state, adjustment rules and usage terms are incomplete.

Change direction:
- Add a Python 3.12 Qlib/LightGBM sidecar with bounded pilot collection, explicit dataset collection and existing-dataset runs.
- Enforce hashed dataset/result contracts, purged rolling windows, future-return labels, transaction costs, candidate training cutoffs and artifact path confinement.
- Add asynchronous job APIs and an AI Research UI for runtime health, progress, datasets, metrics, warnings and candidates.
- Store installed and portable quant workspaces with the same persistence rules as other mutable desktop data.

Verification:
- Node tests: 67/67 passed.
- Python quant tests: 9/9 passed, including no-lookahead features, purged/non-overlapping sample-out folds, non-overlapping holdings, terminal liquidation costs and workspace-contained MLflow artifacts.
- API-started training completed and saved a `quant-backtest` research record; its result and prediction hashes were revalidated before display.
- A 12-symbol public-data pilot completed with 11 successes and 1 explicit failure. Its negative sample-out metrics remain visibly `exploratory`.
- `npm audit --audit-level=low`: 0 known vulnerabilities.
- Final Windows packages built successfully: installer SHA-256 `2894D38A9AFF0750FBC8D2C884ECE4A04CF559A64C33730753D96BDAE3606040`; portable SHA-256 `78938864349E18FD76CE46CB72CE6A3F1B92EA4DA2DFE2BC74F6F208E1C83E58`.
- Final portable-package inspection confirmed that quant source is present while tests, `.venv`, runtime workspaces and `webstock.db` are absent. An isolated launch returned HTTP 200 for both the application and quant-runtime API and created its own `WebStockData` directory.

Follow-ups:
- Add in-app installation of the isolated Python runtime for clean desktop machines; source packaging alone must not be described as an offline-ready model runtime.
- Acquire or prepare terms-verified point-in-time adjusted A-share data before formal validation.
- Run MASTER on the same immutable dataset and rolling folds only after the baseline data gate is satisfied.

## 2026-08-09 19:30 - Verified Windows Quant Runtime Installer

Status: clean-machine runtime installation delivered for Windows x64

Problem:
- The packaged application contained quant source but could not run Qlib on a clean computer without a manually prepared Python environment.
- Direct GitHub asset access can be unreliable on the target network, and an in-place repair could destroy a working runtime if a download or import failed.

Change direction:
- Bundle the SHA-256 verified official uv 0.10.12 Windows x64 archive while keeping Python and packages in the user-owned quant workspace.
- Pin Python 3.12.13 and a 194-package Windows dependency lock with required artifact hashes; offer official PyPI and a domestic mirror without weakening hash verification.
- Build repairs in a staging directory, verify imports, activate, rewrite the relocated `pyvenv.cfg`, verify again, then remove the old runtime and installation caches.
- Expose install, repair, progress and cancellation through the existing quant job API and AI Research workbench.

Verification:
- Runtime-installer unit coverage proves manifest/path/hash checks, corrupted bundle rejection, disk-space rejection before download, failed-repair rollback, successful activation and cancellation cleanup.
- A real install into an empty directory completed in about 105 seconds and passed post-move imports with Python 3.12.13, Qlib 0.9.7 and LightGBM 4.7.0.
- The official uv archive is 22,407,450 bytes with SHA-256 `4C1D55501869B3330D4AABF45AD6024CE2367E0F3AF83344395702D272C22E88`.
- Final regression: Node 74/74, Python quant 9/9, Playwright 5/5; `npm audit` reported 0 known vulnerabilities. Desktop and 390 px layouts have no document-level horizontal overflow.
- Final installer: 121,101,706 bytes, SHA-256 `E7E75A8EB110D2EB3A53EECEC2CCC435F8BB18E7E9638F46DF7889A662B21F8E`.
- Final portable EXE: 111,783,636 bytes, SHA-256 `D8D04F57960D8FC81BB188C57B08F7259924828556A49F1F6571AD676231B55A`.
- Portable-package inspection found the uv asset, lock and manifest, and found no `.venv`, runtime workspace, tests or database. An isolated packaged launch returned `not_configured` plus `installer.available=true` for Python 3.12.13.

Follow-ups:
- Add MASTER only as a same-data exploratory comparison; do not reuse the official repository's flawed validation dump.

## 2026-08-09 21:35 - MASTER, Factor Gates And Evidence-Gated Paper Research

Status: phases C and the first phase-D research slice delivered; formal point-in-time data validation and simulated daily attribution remain pending

Problem:
- A complex model name alone did not make the selection workflow intelligent: LightGBM and MASTER needed a same-data comparison, generated factors needed an admission gate, and model candidates needed evidence and portfolio-risk review before becoming a saved research draft.
- The first decision-packet implementation could mix different quant datasets when the caller omitted a dataset, and the factor-lab API passed unsupported model-training flags to the Python factor command.
- A composite factor ranking could enter consensus even when no individual factor passed the admission gate.

Change direction:
- Add a PyTorch MASTER reimplementation that uses the same immutable manifest, folds, labels, Top-K and transaction-cost contract as LightGBM.
- Add an eight-factor lab that chooses direction and composite weights from validation windows only, reports untouched sample-out IC/stability/duplication/performance, and records candidate/watch/rejected reasons.
- Add a local evidence orchestrator that combines comparable within-source ranks, local screening, holdings/watchlist context, cached business profiles, stable expert evidence and sourced news into a ChatGPT Pro four-role review packet.
- Add a broker-free paper portfolio with maximum position count, single-stock caps, cash reserve, minimum signal count, ST exclusion and draft/active/archived states.
- Upgrade user backup format to version 3 and round-trip paper portfolios without reusing stale research-run IDs.

Verification:
- Same-data exploratory MASTER run `master-20260809T121500Z` completed but did not beat the LightGBM baseline on annualized return, drawdown, Sharpe, turnover or cost; the UI and design document preserve that negative conclusion.
- Factor run `factor-lab-20260809T131500Z` completed on the same dataset and folds. Five factors are watch-only and three rejected; none passed the candidate gate, so its composite ranking is now excluded from decision consensus.
- Node unit/API regression: 84/84 passed. Python quant regression: 20/20 passed. Playwright desktop/mobile regression: 5/5 passed.
- Official npm registry audit reported 0 vulnerabilities. Changed JavaScript syntax checks and Python compilation completed successfully.
- Final installer: 121,126,771 bytes, SHA-256 `996B8F71D07B1273ACC9B8EEC36794724728402CB64D52C7C55A047F6D41F3AA`.
- Final portable EXE: 111,808,086 bytes, SHA-256 `93028EACF23C25D9C6BA19D8FCDA8EBC6764FAB2C295B05B0DC90515EEE8CB58`.
- Isolated portable launch returned HTTP 200, created its own `WebStockData/webstock.db`, exposed the runtime installer, contained the decision/paper/factor sources and no tests, `.venv` or database in `app.asar`.
- Installer, portable wrapper and unpacked `WebStock.exe` exposed the same black/teal atom icon. The existing formal portable database remained byte-identical with SHA-256 `295B4E0F6C33BE936DED9CD4D4BE17A4B0DDA5F8914B51E0A3E4678C2E1B244C`.

Follow-ups:
- Replace exploratory public current-universe daily data with licensed or terms-verified point-in-time adjusted data before approving any model or factor.
- Add paper-account price snapshots, simulated fills, daily attribution and model-versus-portfolio drift review before calling phase D complete.
- Keep AlphaAgent, RD-Agent(Q), TradingAgents and FinRL-X marked planned until their isolated adapters and acceptance evidence exist.

## 2026-08-09 22:35 - Paper Valuation And Android Companion Release

Status: paper-account valuation and cross-device companion release delivered; formal strategy validation remains data-gated

Change direction:
- Persist paper positions and daily valuation snapshots with lot-rounded simulated entry, cash, market value, daily P/L, total P/L, source time and missing-price warnings.
- Keep one user-data authority on Windows. The Android APK is a native companion that connects to the Windows host instead of creating a second SQLite database.
- Protect non-loopback access with a persistent random pairing token exchanged for an HTTP-only strict cookie. Filter displayed addresses to private and shared-LAN ranges.
- Pin and hash-check the Android toolchain, reuse a persistent local release key, and ship the original black/teal WebStock icon.

Verification:
- Node unit/API tests: 93/93 passed, including a real non-loopback `401 -> pairing redirect/cookie -> 200` integration test.
- Python quant tests: 20/20 passed. Playwright desktop/mobile tests: 5/5 passed. Official npm audit: 0 known vulnerabilities.
- Android: Java unit tests, release lint and v2 signature verification passed. Package `com.webstock.companion` targets SDK 36 and requests only the Internet permission; companion-state cloud backup is disabled.
- The APK installed and launched on an ADB-connected Android device. The pairing URL loaded the in-app workbench and exposed the same Windows holdings/dashboard data with no Android crash log. A same-package upgrade retained private pairing state, showed only the sanitized host address and reconnected automatically.
- Android APK: 670,082 bytes, SHA-256 `C7BFFE881C5ECD7CD4458CC1174B583F02366245CF9C974C6D28C56D5BDCB088`.
- Windows installer: 121,130,080 bytes, SHA-256 `C7CB9B67481E3D5449E5AB96337CBC6DC3E8EB060A8C1ADD1DD1C2DC9F72CFB8`.
- Windows portable EXE: 111,809,825 bytes, SHA-256 `21CA7E9C1535AE6514A63DA09BA1E1855FEA621AF860C4369730F6006212950C`.
- Isolated portable launch returned HTTP 200 and exposed quant-runtime and paper-portfolio APIs. The formal portable database remained byte-identical at SHA-256 `295B4E0F6C33BE936DED9CD4D4BE17A4B0DDA5F8914B51E0A3E4678C2E1B244C`.
- Extracted installer and portable icons had identical SHA-256 and displayed the requested black/teal atom artwork.

Remaining boundaries:
- Public current-universe data still supports workflow evidence only; no model or factor is approved as profitable without licensed or terms-verified point-in-time data.
- Android requires the Windows host on the same trusted network. OAuth authentication remains in the system browser by provider design.
- No broker connection or automatic real order submission is present.

## 2026-08-13 13:45 - iPhone PWA, Private HTTPS And Web Push Release

Status: iPhone companion flow delivered as a read-only installable PWA; the Windows host remains the only data authority

Change direction:
- Add a dedicated `mobile.html` shell with account switching, holdings, research counts, explicit source time and A-share red/green semantics.
- Cache only bounded mobile assets and the latest validated snapshot. Offline display remains visibly labeled and never turns missing or stale data into live values.
- Use Tailscale Serve on private HTTPS port 8443 plus the existing pairing-token-to-secure-cookie boundary. Do not use Funnel or expose a public port.
- Add an in-app official Tailscale login handoff. The program accepts only `login.tailscale.com` one-time URLs and never handles user credentials.
- Add generic Web Push for material aggregate changes and research additions. Lock-screen text excludes account names, stock codes, holdings and amounts.

Verification:
- Node regression initially passed 439/439. After the final login and Serve-approval handoff, focused iPhone/Tailscale/push tests passed 12/12; the full run passed 440/441 and the single existing search-index concurrency failure passed immediately in isolation.
- Edge iPhone 13 emulation loaded two accounts online, installed and controlled the service worker, then reloaded offline with the same two-account IndexedDB snapshot and no unexpected console errors.
- Final portable package launched on an isolated port and returned a healthy database status. Its `app.asar` contains the mobile shell, service worker v7 and official login IPC route.
- Final unpacked executable reports WebStock 1.1.0.0 and exposes the black/teal atom icon. The NSIS installer archive test completed without integrity errors.
- The final packages were rebuilt with the Electron 39 native-module ABI, then the portable EXE passed an isolated real launch and the NSIS archive passed a complete integrity test.
- Final installer SHA-256: `9D65578CDB5F9A372F3AFAD34EB9E09999CE57B7E6DEE94D04B95CEC92263BB8`.
- Final portable SHA-256: `EAEA5DAD6C7A5C439589F10E21A79D6566847264F12EC26577E465AB52F97C61`.
- A fresh npm vulnerability audit could not be obtained because the official registry TLS connection closed during the request; this is recorded as unavailable rather than passed.

Operational boundary:
- iPhone live access and push require the Windows host and Tailscale service to remain online. Offline mode is a read-only last snapshot, not a standalone data collector.
- The current Windows machine has official Tailscale 1.102.2 installed, authenticated and serving WebStock privately at `https://cgg.tailc71c66.ts.net:8443`; the full token-bearing pairing URL is kept out of source and was copied to the local clipboard.
