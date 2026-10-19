# Current native Stock review snapshot

Start the review at [the numbered UI audit brief](docs/review/STOCK-UI-AUDIT-20261019.md).

- **Current installed application:** native Qt/C++ Windows Stock (`native/desktop`, `native/domain-cpp`). Independent Java Android source is under `native/android`.
- **Legacy reference:** the root Electron/JavaScript application and `quant` source are retained for behavior/data-pipeline comparison. The root `package.json` is not the native Windows application entry point.
- **Publication form:** a separate source-only audit snapshot branch, not a merge into main and not an executable release. The existing checkout, branch and staging index remain unchanged.
- **Included:** existing tracked project source/configuration, current native source/tests/contracts/icons, current quant bridge source, architecture/review documents. Uncommitted source changes are part of this snapshot; no unrelated cleanup or rollback.
- **Excluded:** production databases, account files, video/media libraries, browser/login profiles, cookies/credentials, private screenshots, generated output/builds, executables/APKs and local dependencies. Binary reference documents and the synthetic MP4 test asset are not published in this snapshot; tests requiring those assets need their original local fixtures. Do not claim this standalone snapshot has passed every test.
- **Review scope:** fixed chart geometry, state/data separation, loading and refresh lifecycle, drag/zoom/crosshair consistency, source freshness, all functional pages, cancellation/draft/data protection, thread/SQLite use and publication/security boundaries.

See `native/CMakeLists.txt` and `native/desktop/CMakeLists.txt` for the native build. `BUILD_REVIEW_UI` enables Qt6 UI targets. Current local toolchain is Qt6.9.1/MinGW13.1/C++17; Android uses its Gradle/JDK/SDK environment. Some historical tests use local fixture paths or task-local outputs and are not portable as written; the audit must record this limitation.

Do not use unit-test success or this source upload as proof that the installed application behaves correctly on every page. Keep the review and proposed changes evidence-grounded, numbered, and split into independently verifiable batches. Do not enable deferred cross-device/L2/paid-source/AI or trading tasks.
