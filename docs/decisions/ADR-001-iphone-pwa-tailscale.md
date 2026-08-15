# ADR-001: Use a private PWA companion for iPhone

## Status

Accepted

## Date

2026-08-13

## Context

WebStock is Windows-first and the user does not currently operate a public server. The iPhone experience must reuse the Windows database, remain usable away from the local LAN, retain a recent read-only snapshot offline, and avoid requiring App Store distribution or an Apple Developer Program membership.

## Decision

Use a dedicated installable PWA at `/mobile.html` and expose it privately through Tailscale Serve HTTPS on port `8443`.

- Windows remains the only data and collection authority.
- The mobile API exposes a bounded read-only snapshot with explicit provenance and stale states.
- The PWA stores only its latest snapshot in origin-scoped IndexedDB.
- Tailscale controls private network membership; WebStock still exchanges its pairing token for a secure strict HTTP-only cookie.
- Standard Web Push provides privacy-preserving change notifications. Subscription endpoints and VAPID keys remain in the Windows data directory.

## Alternatives Considered

### Native iOS application

Rejected for the current phase because repeatable IPA/TestFlight distribution requires a Mac/Xcode signing workflow and generally an Apple Developer Program membership. It would duplicate the already sufficient read-only companion surface.

### Public cloud deployment

Rejected because the user has no server and portfolio/research data should not be publicly exposed. It would also introduce account administration, TLS, backups, operating cost, and a larger security boundary.

### Plain HTTP over a Tailscale IP

Rejected for iPhone installation because service workers, offline behavior and Web Push require a secure context. Tailscale Serve supplies tailnet-only HTTPS without router port forwarding.

## Consequences

- The Windows host and Tailscale must be online for fresh data.
- Offline mode is explicitly a saved snapshot, not a standalone trading application.
- Push timing is informative rather than exchange-real-time.
- Tailscale installation and the first interactive login remain user-controlled steps.
