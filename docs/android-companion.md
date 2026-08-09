# WebStock Android Companion

## Boundary

The Android package is a native companion for the Windows WebStock host. It does not create a second SQLite database and does not run an independent trading server on the phone. Holdings, watchlists, research records, and paper portfolios remain in the Windows WebStock data directory.

This design keeps one source of truth while providing an Android application window instead of requiring Chrome. It requires the phone and Windows computer to be on the same trusted local network, with the Windows host running.

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
dist\android\WebStock-Android-Companion-1.0.0.apk
```

## Connect

Install or open the Windows WebStock application, then:

1. Open `设置`.
2. Find `手机连接（安卓）` and choose `开启手机连接`.
3. Copy one complete pairing URL shown by the Windows app.
4. Open the Android companion and enter the complete URL, including the `pair` parameter.

The Android app exchanges the token for an HTTP-only pairing cookie. The visible server setting retains only the host and port; the token is held separately in private, non-backed-up app storage so an APK upgrade can reconnect without exposing it in the address field. A 401 response clears the saved token and asks for a new complete pairing URL. Choose `关闭手机连接` on Windows when phone access is not needed.

For source-tree development only, the equivalent fallback is:

```powershell
npm run start:android
```

The terminal prints the same type of complete `Android pairing URL` values. This command is not required for installed or portable Windows releases.

Allow Node.js/WebStock through Windows Firewall only for private networks. ChatGPT, OpenAI, and Google authentication opens in the Android system browser because those providers do not support embedded WebView OAuth. Normal HTTPS news and research pages can remain inside the companion window.

To rotate the pairing token, close WebStock and delete `lan-pairing-token` from `%APPDATA%\WebStock` (installed edition) or `WebStockData` beside the portable executable. Reopen WebStock and enable phone access again. Existing paired devices will then require the new complete URL.

## Verified Artifact

The 2026-08-09 release build passed Java unit tests, Android release lint, APK Signature Scheme v2 verification, package/permission inspection, installation, upgrade reconnection, and a live connection on an ADB-connected Android device. The connected app displayed the same Windows holdings and dashboard data without a second phone-side database.
