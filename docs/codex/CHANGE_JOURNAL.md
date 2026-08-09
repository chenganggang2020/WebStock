# Change Journal

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
