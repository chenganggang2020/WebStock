# WebStock Quant Sidecar

This isolated Python 3.12 runtime provides reproducible Qlib + LightGBM and MASTER-style market-guided Transformer comparisons.

It does not read the WebStock SQLite portfolio database and it does not submit orders. Input and output cross the process boundary only through explicit files and JSON events.

## Commands

- `runner.py health --verify`: import and report the real runtime versions.
- `runner.py collect`: collect an explicitly selected public daily-data dataset and write a hashed manifest.
- `runner.py run --model lightgbm|master`: execute purged rolling validation with transaction costs on the same dataset contract.
- `runner.py pilot`: collect a bounded sample and run the complete exploratory workflow.

## Windows runtime installation

The AI Research view can install the runtime into the configured quant workspace. The installer verifies the bundled official uv 0.10.12 archive, creates a relocatable Python 3.12.13 environment, installs the Windows x64 dependency lock with required hashes, and verifies Qlib, LightGBM, and PyTorch before and after activation. It never modifies the system `PATH` or system Python.

The MASTER implementation uses training-only robust scaling, an eight-observation lookback, market feature gating, temporal attention, and cross-stock attention. Validation and inference preserve all feature-valid instruments and filter missing labels only for metrics. It follows the official MASTER architecture concepts but does not load an official checkpoint; all outputs remain exploratory until the data contract is validation-eligible.

The user may select official PyPI or the Tsinghua mirror. Package hashes remain mandatory in either mode. A cancelled or failed repair preserves the previous runtime. Installation caches and bootstrap tools are removed after verification; `install-receipt.json` records the versions and hashes that were activated.

The bundled Sina adapter is exploratory only. Its current-list universe, incomplete historical ST state, unadjusted prices, public endpoint terms, and failed symbols are recorded in every manifest. Such data can never produce a `validated` result under the WebStock contract.

All mutable files stay under the configured quant workspace: `datasets/`, `runs/`, `jobs/`, and `qlib-runtime/`. Dataset and prediction artifacts are SHA-256 verified before a result is shown or saved. Result files use relative dataset references so a portable workspace can be moved with the application.
