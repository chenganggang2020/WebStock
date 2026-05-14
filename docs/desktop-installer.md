# Desktop Installer

Build a Windows installer:

```powershell
npm run dist:win
```

The installer is written to:

```text
release/
```

For a fast unpacked desktop build that is useful for testing:

```powershell
npm run dist:win:dir
```

The build script rebuilds `better-sqlite3` for Electron before packaging and
restores it for local Node.js after packaging. This keeps both the desktop app
and `npm start` usable from the same checkout.

The desktop app starts the existing WebStock server inside Electron and opens the UI in an application window. User data is stored under Electron's `userData` directory, so the app can be installed under `Program Files` without needing write access to the installation folder.
