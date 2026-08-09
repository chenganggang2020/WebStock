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
