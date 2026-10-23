# ADR 052: Windows media transport without changing security settings

Date: 2026-10-18. Status: implemented; real transfer and local ASR/publication accepted, per-author coverage remains explicit below.

## Objective and evidence

The current Qt 6.9.1/Schannel GET repeatedly stops partway through an allowed
51,026,590-byte MP4, including a minimal read-only QNetworkAccessManager program.
Default buffers, identity encoding and bounded ranges did not solve it. Standard
HTTPS reads, both through the existing system proxy and directly, completed with
the identical SHA256. This localizes the fault to that Qt transport path; the
specific underlying Qt defect is not proven. Do not label this as CDN denial.

## Plan and scope

1. Use Windows' existing WinHTTP API on a worker thread for media GET only.
2. Adapt it to QNetworkReply so CollectionDownload retains its host/redirect,
   content type, 256 MiB, length, MP4, SHA256 and atomic-file checks.
3. Keep one bounded 64 KiB delivery in flight; cancellation invalidates the reply
   immediately and does not wait on the UI thread. Worker OS calls have timeouts.
4. Re-run focused download/pipeline tests, build, verify an actual complete media
   transfer, then download/ASR/publication from Stock before claiming acceptance.

## Constraints

- System proxy discovery only; no global proxy, TLS, certificate or OS changes.
- Default certificate verification; no ignored TLS errors, cookie/session access,
  authentication headers or automatic credentials. No automatic redirects in the
  transport: existing exact HTTPS/CDN checks must approve each destination.
- No new installed package. WinHTTP is an existing Windows system API.
- No DB schema change, overwrite of old media/text, or automatic enabling of
  stopped authors. Existing queue failure/identity/receipt protection remains.
- Match existing C++/Qt style: small QObject components, RAII handles, explicit
  bounds and status. Adapter files live in native/desktop; Qt tests in native/tests.

## Verification commands

Use the existing desktop-open CMake configuration. Explicitly configure after the
new source registration, then build collection_download_tests, collection_pipeline_tests,
source_page_tests and MarketNativeReview individually with --parallel 1.
Test executables take `-o <absolute-evidence-path>,txt`; Qt platform is windows.
Never treat fake network/ASR tests as the real four-author acceptance.

Reference: https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpopen

Rejected: removing certificate checks, changing system proxy, endless retry,
loosening validation, or adopting the unsuccessful range/buffer experiments.

## Post-build verification, 2026-10-18

- Focused download tests: 8 passed; pipeline: 17 passed; affected source page:
  10 passed (counts include init/cleanup). Immediate cancel initially emitted
  completion twice; guarded completion fixes the reproduced case. Five older
  pipeline checks asserted before the queue ran; their waits were corrected to
  observe the actual persisted outcome, without relaxing product validation.
- Native media transport downloaded an actual 51,026,590-byte MP4, SHA256
  `46586c003d4c4aeac5734ddd7bf06369873e0e1441f5fe60a38b505d76cdfc34`.
- Updated Stock independently downloaded that same complete file, ran the
  existing offline CPU ASR and created one matching research document: 480
  characters / 24 ASR segments. These are machine transcripts, not human-verified
  facts or transcription accuracy claims.
- Hidden scheduled-source page completed a Model author round: 19 discovered,
  18 details processed, 1 stopped task protected, no new queued task. Previous
  hidden run timed out after 2 details. This is separate from downstream proof.
- Ellie source round processed 19/21 discovered, protected 2 stopped jobs, queued
  8. Three had actual download/ASR/publication receipts by 11:59 Beijing; five
  returned HTTP 403 from their supplied CDN links. That external refusal is not
  repaired by the transport and is NOT counted as completed collection.
- Current deployment receipt is
  `D:/Stock/backups/source-detail-fix-20261018T0341171354Z/deployment.json`.
  10,738 files backed up and equal during replacement; installed EXE SHA256
  `CC6E336796AF7F696097CF6212245D847A5FAFF28852EEB98EDDAB2B54EC6646`.
- This note is post-build evidence, not part of the earlier frozen input hash.
