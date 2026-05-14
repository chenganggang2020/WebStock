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

CREATE TABLE IF NOT EXISTS recent_stocks (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_viewed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  view_count INTEGER DEFAULT 1,
  last_price REAL,
  last_change REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sector_leaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '观察股',
  reason TEXT DEFAULT '',
  weight REAL DEFAULT 1,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_screener_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL,
  strategy TEXT NOT NULL,
  demand TEXT DEFAULT '',
  result_json TEXT NOT NULL,
  ai_result TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS screener_candidate_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'watch',
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (result_id) REFERENCES ai_screener_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sector_leader_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leader_id INTEGER,
  sector_id INTEGER,
  sector_name TEXT DEFAULT '',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL,
  change REAL,
  amount REAL,
  captured_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hot_market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  source TEXT DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hot_market_ai_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER,
  result_text TEXT NOT NULL,
  parsed_json TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id) REFERENCES hot_market_snapshots(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_profiles (
  code TEXT PRIMARY KEY,
  source TEXT DEFAULT '',
  payload_json TEXT NOT NULL,
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_search_index (
  code TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  industry TEXT DEFAULT '',
  boards_text TEXT DEFAULT '',
  business_scope TEXT DEFAULT '',
  business_summary TEXT DEFAULT '',
  main_business_json TEXT DEFAULT '[]',
  tags_text TEXT DEFAULT '',
  search_text TEXT NOT NULL,
  source TEXT DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_watchlist_group ON watchlist(group_name);
CREATE INDEX IF NOT EXISTS idx_trades_code ON trades(code);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(trade_date);
CREATE INDEX IF NOT EXISTS idx_recent_stocks_viewed ON recent_stocks(last_viewed_at);
CREATE INDEX IF NOT EXISTS idx_sector_leaders_sector ON sector_leaders(sector_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sector_leaders_unique ON sector_leaders(sector_id, code, role);
CREATE INDEX IF NOT EXISTS idx_screener_candidate_notes_result ON screener_candidate_notes(result_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_screener_candidate_notes_unique ON screener_candidate_notes(result_id, code);
CREATE INDEX IF NOT EXISTS idx_sector_leader_snapshots_code ON sector_leader_snapshots(code, captured_at);
CREATE INDEX IF NOT EXISTS idx_sector_leader_snapshots_leader ON sector_leader_snapshots(leader_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_hot_market_snapshots_date ON hot_market_snapshots(snapshot_date, created_at);
CREATE INDEX IF NOT EXISTS idx_hot_market_ai_results_snapshot ON hot_market_ai_results(snapshot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_profiles_fetched ON stock_profiles(fetched_at);
CREATE INDEX IF NOT EXISTS idx_stock_search_index_name ON stock_search_index(name);
CREATE INDEX IF NOT EXISTS idx_stock_search_index_industry ON stock_search_index(industry);
