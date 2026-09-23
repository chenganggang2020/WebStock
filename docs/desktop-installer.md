# Desktop Installer

Build the Windows installer:

```powershell
npm run dist:win
```

The only installer artifact is:

```text
dist/installer/WebStock-Setup-1.0.0.exe
```

The installer defaults to:

```text
D:\Program Files\WebStock
```

The user can choose a different directory during setup. Installed application
data remains in Electron's per-user `WebStock` data directory under `%APPDATA%`,
so updating or reinstalling the application does not overwrite the portfolio
database.

For an unpacked developer build:

```powershell
npm run dist:win:dir
```

That output is for debugging only and is written to `dist/unpacked`. The build
script rebuilds `better-sqlite3` for Electron before packaging and restores it
for local Node.js afterward, keeping both the desktop package and `npm start`
usable from the same checkout.

The application and installer use `icons/webstock.ico`. The package is not
code-signed, so Windows SmartScreen may show a warning on another computer.
