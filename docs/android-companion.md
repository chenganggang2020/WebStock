# WebStock Android Companion

## Boundary

The Android package is a native companion for the Windows WebStock host. It does not create a second SQLite business database and does not run an independent trading server on the phone. Holdings, watchlists, research records, and paper portfolios remain in the Windows WebStock data directory.

This design keeps one source of truth while providing an Android application window instead of requiring Chrome. Online use requires the Windows host to be running. The phone can connect through either the same trusted LAN or a Tailscale private network. No public port is required.

The companion stores one private, read-only mobile snapshot after a successful connection. If the Windows host later becomes unreachable, the app shows account cards, holdings valuation state, and research-library counts from that snapshot. Missing market data stays unavailable; a dated broker snapshot may be shown explicitly, but cost price is never presented as a live quote. Video bodies, transcript text, local media paths, pairing tokens, and credentials are not included in the mobile snapshot.

## Build

Run:

```powershell
npm run dist:android
```

The first build installs a pinned Android build toolchain under `D:\WebStockAndroidTools`. The release signing key is generated once under `%APPDATA%\WebStock\android-signing` and reused for upgrades. Back up that directory; losing the key prevents a future APK from upgrading the installed app in place.

Pinned build inputs:

- Microsoft OpenJDK 17.0.20: https://learn.microsoft.com/java/openjdk/download
- Android command-line tools and SDK platform 36: https://developer.android.com/studio
- Android Gradle Plugin 9.2.0 compatibility: https://developer.android.com/build/releases/agp-9-2-0-release-notes
- Gradle 9.4.1 distribution and wrapper checksums: https://gradle.org/release-checksums/

The installer checks downloaded SHA-256 values before extraction. The Gradle wrapper also pins the distribution SHA-256 in `android/gradle/wrapper/gradle-wrapper.properties`.

Output:

```text
dist\android\WebStock-Android-Companion-1.1.0.apk
```

## Connect

Install or open the Windows WebStock application, then:

1. Open `设置`.
2. Find `手机连接（安卓）` and choose `开启手机连接`.
3. For the same Wi-Fi/LAN, copy the option labelled `局域网`.
4. For access away from home, install and sign in to Tailscale on Windows and Android, then copy the option labelled `Tailscale 远程`.
5. Open the Android companion and enter the complete URL, including the `pair` parameter.

The Android app exchanges the token for an HTTP-only pairing cookie. The visible server setting retains only the host and port; the token is held separately in private, non-backed-up app storage so an APK upgrade can reconnect without exposing it in the address field. A 401 response clears the saved token and asks for a new complete pairing URL. Choose `关闭手机连接` on Windows when phone access is not needed.

For source-tree development only, the equivalent fallback is:

```powershell
npm run start:android
```

The terminal prints the same type of complete `Android pairing URL` values. This command is not required for installed or portable Windows releases.

Allow Node.js/WebStock through Windows Firewall only for private networks. Do not forward port 3000 on the router and do not expose it directly to the public internet. Tailscale encrypts traffic between signed-in devices; WebStock still requires its separate pairing token. ChatGPT, OpenAI, and Google authentication opens in the Android system browser because those providers do not support embedded WebView OAuth. Normal HTTPS news and research pages can remain inside the companion window.

## Offline Snapshot And Background Updates

The connection panel includes a `每 15 分钟后台更新并通知` switch. Turning it on schedules a network-constrained Android WorkManager task. Android 13 and later asks for notification permission at that moment. Notifications are private and deliberately omit account names, holdings, and amounts.

Android's minimum periodic WorkManager interval is 15 minutes. The operating system may run it later because of Doze, battery optimization, network availability, or vendor background restrictions. It is therefore a durable refresh mechanism, not a real-time market-data channel. Opening the online WebStock page also refreshes the saved snapshot.

Background refresh requirements:

- Windows WebStock remains running with `手机连接` enabled.
- The phone can reach the saved LAN or Tailscale address.
- The pairing token remains valid.
- Tailscale remains connected when the saved address is a `100.64.0.0/10` address.

If background access is no longer needed, turn off the switch in the Android connection panel. This cancels the periodic work without deleting the last read-only snapshot.

## Remote Access Boundary

Tailscale is the supported no-server remote path. WebStock accepts its carrier-grade NAT range (`100.64.0.0/10`) as a private address and labels it separately in Windows settings. The app intentionally rejects arbitrary public hosts. Codex recurring tasks can collect or audit data on the Windows computer, but they are supplementary automation and do not replace the running WebStock host, the mobile UI, or its database.

To rotate the pairing token, close WebStock and delete `lan-pairing-token` from `%APPDATA%\WebStock` (installed edition) or `WebStockData` beside the portable executable. Reopen WebStock and enable phone access again. Existing paired devices will then require the new complete URL.

## Verified Artifact

The 2026-08-09 release build passed Java unit tests, Android release lint, APK Signature Scheme v2 verification, package/permission inspection, installation, upgrade reconnection, and a live connection on an ADB-connected Android device. The connected app displayed the same Windows holdings and dashboard data without a second phone-side database.
