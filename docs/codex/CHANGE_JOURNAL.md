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
