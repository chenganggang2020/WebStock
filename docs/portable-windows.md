# Windows Portable Package

Run this on the development computer:

```powershell
npm run package:portable
```

The generated folder is:

```text
dist/WebStock-Portable
```

Copy the whole `WebStock-Portable` folder to another Windows computer and double-click `WebStock.cmd`.

Notes:

- The package includes `node.exe`, `node_modules`, static assets, stock lists, and the local SQLite data folder.
- Data is stored in `WebStock-Portable/data/webstock.db`.
- The launcher uses `127.0.0.1` and automatically picks a free port starting at `3000`.
- Real-time quotes, F10 business tags, and news still need network access.
