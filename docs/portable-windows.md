# Windows Portable Package

Build the single-file portable package on Windows:

```powershell
npm run dist:win:portable
```

The only distributable file is:

```text
dist/portable/WebStock-Portable-1.0.0.exe
```

Copy that EXE to another Windows computer and run it directly. On first run,
WebStock creates a `WebStockData` directory beside the EXE. Keep the EXE and
that directory together when moving an existing portfolio to another computer.
If no portable database exists, WebStock automatically migrates the existing
installed database from the current user's Electron data directory.

Runtime details:

- The local application URL is fixed at `http://127.0.0.1:3000/`.
- If port 3000 is occupied, WebStock reports the conflict instead of silently
  moving to another URL.
- The SQLite database is stored at `WebStockData/webstock.db`.
- Rebuilding the portable EXE preserves an existing `WebStockData` directory.
- Level-2 connection settings are stored at `WebStockData/level2-config.json`.
- Real-time quotes, business tags, news, and other market feeds still require
  network access.
- The package is not code-signed, so Windows SmartScreen may show a warning.

Build both the installer and portable package with:

```powershell
npm run dist:win:all
```
