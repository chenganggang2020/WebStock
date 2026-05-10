CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  group_name TEXT DEFAULT '默认分组',
  note TEXT DEFAULT '',
  alert_high REAL,
  alert_low REAL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell', 'dividend', 'fee')),
  trade_date TEXT NOT NULL,
  price REAL DEFAULT 0,
  quantity INTEGER DEFAULT 0,
  fee REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  total_market_value REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  unrealized_pnl REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  total_pnl REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_watchlist_group ON watchlist(group_name);
CREATE INDEX IF NOT EXISTS idx_trades_code ON trades(code);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(trade_date);
