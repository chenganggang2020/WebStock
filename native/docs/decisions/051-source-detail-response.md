# ADR 051: Read the detail response loaded by the current source page

Date: 2026-10-18. Status: implementation under real-source verification.

## Evidence and decision

The signed-in Fioona work page plays normally, but its streaming document has
`awemeId` with `aweme: null` and no legacy author-labelled DOM elements. Static
embedded JSON alone cannot provide the author/media binding. The legacy
Electron media probe already recognized the official work-detail endpoint.

Extend ADR 012's embedded-content-only extraction to passively observe the
official page's own GET response at `/aweme/v1/web/aweme/detail/`. Use the
existing WebView2 response event, not an extra fetch, CDP, DOM player URL,
React internals, copied session, or reconstructed signature.

## Constraints

- Match the exact HTTPS official host, current work-page ID and unique request
  `aweme_id`; require HTTP 200, successful JSON status and matching detail ID.
- Read at most 2 MiB. Keep only content fields needed by the extractor in
  process memory; do not read headers/cookies or persist response bodies.
- Clear on navigation/stop. Reject late responses by navigation generation,
  response generation and URL; expire the accepted detail after 120 seconds.
- Preserve provenance as `detail_response`; both author and work checks remain
  mandatory downstream. Login/challenge and existing held-task barriers remain.
- The media CDN/download, local ASR and publication still require actual
  end-to-end verification. Passing parser tests alone is not acceptance.

Microsoft reference: [WebResourceResponseView.GetContent](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2webresourceresponseview).

No database migration, security-setting change, new dependency or collection
plan activation is part of this adapter change.
