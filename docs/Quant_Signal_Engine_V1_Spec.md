# WebStock Quant Signal Engine V1

## Objective

Build a local, explainable stock-screening and monitoring loop for WebStock. A user can describe or select a deterministic model, scan an eligible A-share universe, inspect why each candidate matched, review confirmation and invalidation conditions, backtest the same versioned rule, and add selected candidates to monitoring. V1 implements two daily models:

1. Low-position high-volume price-stagnation (`low-position-volume-stagnation`).
2. High-volume breakout of the prior range (`volume-breakout`).

Signals are research candidates, not recommendations. V1 never submits orders or changes broker state.

## Tech Stack

- Node.js CommonJS services and Express routes.
- Python 3.12 quant sidecar with pandas/numpy for research and backtesting.
- Vanilla browser JavaScript and the existing WebStock UI shell.
- Node built-in test runner and Python `unittest`.
- Existing SQLite and quant workspace contracts; no new external dependency.

## Commands

- Node focused tests: `node --test test/strategyRuleService.test.js test/quantSignalModel.test.js test/quantSignalApi.test.js`
- Python focused tests: `cmd /c "set PYTHONPATH=quant&& set PYTHONUTF8=1&& quant\.venv\Scripts\python.exe -m unittest quant.tests.test_strategy_lab -v"`
- Full Node regression: `npm test`
- Full quant regression: `npm run test:quant`
- Development server: `npm start`
- Health check: `Invoke-RestMethod http://127.0.0.1:3000/api/health`

## Project Structure

- `services/strategyRuleService.js`: deterministic natural-language allowlist and versioned rule cards.
- `services/quantSignalService.js`: feature calculation, eligibility gates, scans, evidence, confirmation, and invalidation output.
- `routes/quant.js`: scan and rule-card APIs.
- `quant/webstock_quant/strategy_lab.py`: same-family backtest execution and A-share execution assumptions.
- `js/modules/aiResearch.js`: model cards, rule preview, scan results, and monitoring handoff.
- `test/`: Node unit, API, and UI contract tests.
- `quant/tests/`: Python feature and backtest tests.

## Code Style

Match existing CommonJS and deterministic service style. Pure functions receive explicit data and options and return JSON-safe results.

```js
function evaluateCandidate(rows, ruleCard) {
  return {
    matched: true,
    evidence: [{ key: 'volumeRatio20', value: 1.92, threshold: 1.8 }],
    confirmation: ['未来3个交易日收盘突破信号日最高价'],
    invalidation: ['收盘跌破信号日最低价']
  };
}
```

## Testing Strategy

- Pure unit tests for feature formulas, exact boundaries, missing data, ST/suspension/limit states, and deterministic output.
- Contract tests proving natural-language parsing produces a validated rule card and unsupported language cannot execute code.
- API tests proving ineligible datasets are blocked and eligible scans preserve source/freshness/coverage metadata.
- Python tests proving signal-at-close executes no earlier than the next executable open and retains T+1/cost assumptions.
- Browser contract and runtime tests for rule preview, candidate evidence, no-result, blocked, stale, and error states.
- Full Node and quant regression after each completed vertical slice.

## Boundaries

### Always

- Use one versioned rule definition for scan, backtest, chart annotation, and alert evaluation.
- Preserve source, observed time, coverage, warnings, and validation eligibility.
- Separate detection, confirmation, and invalidation.
- Use point-in-time inputs only; do not silently fill missing factors.
- Default new signals and alerts to disabled until the user enables them.

### Ask First

- Adding a paid/licensed market-data provider.
- Changing the production SQLite schema in a destructive or irreversible way.
- Enabling broker connectivity or automatic execution.
- Packaging or publishing a release.

### Never

- Execute AI-generated code or SQL.
- Label a screen result as a buy recommendation or guaranteed opportunity.
- Backfill missing market data with invented values.
- Optimize parameters on the held-out test period.
- Modify Tonghuashun trading, login, credentials, or account state.

## Success Criteria

- A validated V2 rule card exists for both V1 model families.
- Low-position volume stagnation and volume breakout produce deterministic evidence, confirmation, invalidation, and exclusions.
- The scan refuses a formal result when the full-market dataset is missing or ineligible.
- An eligible dataset can be scanned without watchlist/holding/recent-view points influencing rank.
- The same rule family and parameters reach the Python backtest without semantic translation drift.
- Candidate results can be handed to the existing watchlist/monitoring flow only after explicit user action.
- Focused tests, full Node tests, and full quant tests pass; browser verification shows no blocking console error.

## Approved Scope For This Increment

- Complete the data eligibility gate and expose actionable baseline status.
- Implement the two V1 daily model families end to end.
- Reuse existing quant datasets, manifests, factor lab, strategy lab, and portfolio APIs.
- Do not add machine-learning ranking, automatic trading, paid data, or packaging in this increment.

## Open Questions

None blocking. Default thresholds are editable research defaults and must be shown before running:

- Low position: 120-day range position at or below 35%.
- High volume: current volume at least 1.8 times the 20-day average.
- Price stagnation: absolute daily return at or below 2%, daily range at or below 6%.
- Breakout: close above prior 20-day high by at least 0.5%, with volume at least 1.5 times the 20-day average.
