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

CREATE TABLE IF NOT EXISTS portfolio_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  broker TEXT DEFAULT '',
  masked_number TEXT DEFAULT '',
  cash_balance REAL NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO portfolio_accounts
  (id, account_key, name, broker, masked_number, cash_balance, is_default, enabled, note)
VALUES
  (1, 'default', '默认账户', '', '', 0, 1, 1, '升级前已有持仓和交易记录');

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'manual',
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
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL DEFAULT 1,
  snapshot_date TEXT NOT NULL,
  total_market_value REAL DEFAULT 0,
  cash_balance REAL DEFAULT 0,
  total_assets REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  unrealized_pnl REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  total_pnl REAL DEFAULT 0,
  today_pnl REAL DEFAULT 0,
  source_label TEXT DEFAULT '',
  holdings_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  published_at TEXT DEFAULT '',
  tags_json TEXT DEFAULT '[]',
  stock_codes_json TEXT DEFAULT '[]',
  sectors_json TEXT DEFAULT '[]',
  content_hash TEXT NOT NULL UNIQUE,
  original_content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  evidence_id TEXT NOT NULL UNIQUE,
  chunk_index INTEGER NOT NULL,
  char_start INTEGER NOT NULL DEFAULT 0,
  char_end INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
  evidence_id UNINDEXED,
  chunk_id UNINDEXED,
  source_id UNINDEXED,
  title,
  author,
  content,
  tags,
  tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS ai_research_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  title TEXT DEFAULT '',
  question TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  result_text TEXT DEFAULT '',
  evidence_json TEXT DEFAULT '[]',
  request_json TEXT DEFAULT '{}',
  metrics_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expert_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'creator',
  platform TEXT NOT NULL,
  profile_url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  aliases_json TEXT DEFAULT '[]',
  discovery_queries_json TEXT DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expert_sync_jobs (
  channel_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'idle',
  last_started_at TEXT DEFAULT '',
  last_completed_at TEXT DEFAULT '',
  next_run_at TEXT DEFAULT '',
  last_error TEXT DEFAULT '',
  last_result_json TEXT DEFAULT '{}',
  run_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES expert_channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expert_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  external_key TEXT NOT NULL,
  external_content_id TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  published_at TEXT DEFAULT '',
  published_time_precision TEXT NOT NULL DEFAULT 'unknown',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  evidence_level TEXT NOT NULL,
  availability_status TEXT NOT NULL,
  content_role TEXT NOT NULL,
  content_text TEXT DEFAULT '',
  summary_text TEXT DEFAULT '',
  description_text TEXT DEFAULT '',
  transcript_text TEXT DEFAULT '',
  engagement_json TEXT DEFAULT '{}',
  media_metadata_json TEXT DEFAULT '{}',
  signal_json TEXT DEFAULT '{}',
  content_hash TEXT NOT NULL,
  stock_codes_json TEXT DEFAULT '[]',
  sectors_json TEXT DEFAULT '[]',
  topics_json TEXT DEFAULT '[]',
  media_type TEXT NOT NULL DEFAULT 'text',
  archive_status TEXT NOT NULL DEFAULT 'linked',
  rights_basis TEXT NOT NULL DEFAULT 'quotation_only',
  local_asset_path TEXT DEFAULT '',
  curve_data_json TEXT DEFAULT '[]',
  analysis_notes TEXT DEFAULT '',
  stance TEXT DEFAULT 'unknown',
  horizon TEXT DEFAULT 'unspecified',
  confidence REAL NOT NULL DEFAULT 0.5,
  knowledge_source_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, external_key),
  FOREIGN KEY (channel_id) REFERENCES expert_channels(id) ON DELETE CASCADE,
  FOREIGN KEY (knowledge_source_id) REFERENCES knowledge_sources(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_expert_observations_channel_time
  ON expert_observations(channel_id, published_at, first_seen_at);

CREATE TABLE IF NOT EXISTS expert_observation_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  likes INTEGER,
  comments INTEGER,
  favorites INTEGER,
  shares INTEGER,
  plays INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(observation_id, observed_at),
  FOREIGN KEY (observation_id) REFERENCES expert_observations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expert_observation_metrics_time
  ON expert_observation_metrics(observation_id, observed_at);

CREATE TABLE IF NOT EXISTS expert_backtests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  observation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'exploratory',
  signal_at TEXT NOT NULL,
  eligible_at TEXT DEFAULT '',
  instrument_code TEXT NOT NULL,
  benchmark_code TEXT DEFAULT '',
  horizons_json TEXT DEFAULT '[1,5,20,60]',
  methodology_json TEXT DEFAULT '{}',
  result_json TEXT DEFAULT '{}',
  run_id TEXT DEFAULT '',
  dataset_id TEXT DEFAULT '',
  result_path TEXT DEFAULT '',
  result_sha256 TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES expert_channels(id) ON DELETE CASCADE,
  FOREIGN KEY (observation_id) REFERENCES expert_observations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS paper_portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
  as_of TEXT NOT NULL,
  capital REAL NOT NULL DEFAULT 100000,
  cash_weight REAL NOT NULL DEFAULT 1,
  risk_profile TEXT NOT NULL DEFAULT 'balanced',
  constraints_json TEXT NOT NULL DEFAULT '{}',
  rationale TEXT DEFAULT '',
  source_run_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_run_id) REFERENCES ai_research_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS paper_portfolio_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  target_weight REAL NOT NULL,
  consensus_score REAL NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  rationale TEXT DEFAULT '',
  risks_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_portfolio_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  entry_value REAL NOT NULL,
  entry_fee REAL NOT NULL DEFAULT 0,
  last_price REAL NOT NULL,
  last_market_value REAL NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL,
  market_date TEXT DEFAULT '',
  market_time TEXT DEFAULT '',
  cash_value REAL NOT NULL,
  market_value REAL NOT NULL,
  total_value REAL NOT NULL,
  daily_pnl REAL NOT NULL,
  total_pnl REAL NOT NULL,
  total_return REAL NOT NULL,
  source TEXT DEFAULT '',
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id) ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_type ON knowledge_sources(source_type, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_author ON knowledge_sources(author, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_chunks_source_order ON knowledge_chunks(source_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_ai_research_runs_type ON ai_research_runs(run_type, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_research_runs_model ON ai_research_runs(model_id, created_at);
CREATE INDEX IF NOT EXISTS idx_paper_portfolios_status ON paper_portfolios(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_portfolio_item_unique ON paper_portfolio_items(portfolio_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_portfolio_position_unique ON paper_portfolio_positions(portfolio_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_portfolio_snapshot_unique ON paper_portfolio_snapshots(portfolio_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_paper_portfolio_snapshots_time ON paper_portfolio_snapshots(portfolio_id, snapshot_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_knowledge_chunk_insert
AFTER INSERT ON knowledge_chunks
BEGIN
  INSERT INTO knowledge_chunks_fts (evidence_id, chunk_id, source_id, title, author, content, tags)
  SELECT NEW.evidence_id, NEW.id, NEW.source_id, source.title, source.author, NEW.content,
    source.tags_json || ' ' || source.stock_codes_json || ' ' || source.sectors_json
  FROM knowledge_sources AS source
  WHERE source.id = NEW.source_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_chunk_update
AFTER UPDATE ON knowledge_chunks
BEGIN
  DELETE FROM knowledge_chunks_fts WHERE chunk_id = OLD.id;
  INSERT INTO knowledge_chunks_fts (evidence_id, chunk_id, source_id, title, author, content, tags)
  SELECT NEW.evidence_id, NEW.id, NEW.source_id, source.title, source.author, NEW.content,
    source.tags_json || ' ' || source.stock_codes_json || ' ' || source.sectors_json
  FROM knowledge_sources AS source
  WHERE source.id = NEW.source_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_chunk_delete
AFTER DELETE ON knowledge_chunks
BEGIN
  DELETE FROM knowledge_chunks_fts WHERE chunk_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_source_metadata_update
AFTER UPDATE OF title, author, tags_json, stock_codes_json, sectors_json ON knowledge_sources
BEGIN
  DELETE FROM knowledge_chunks_fts WHERE source_id = NEW.id;
  INSERT INTO knowledge_chunks_fts (evidence_id, chunk_id, source_id, title, author, content, tags)
  SELECT chunk.evidence_id, chunk.id, NEW.id, NEW.title, NEW.author, chunk.content,
    NEW.tags_json || ' ' || NEW.stock_codes_json || ' ' || NEW.sectors_json
  FROM knowledge_chunks AS chunk
  WHERE chunk.source_id = NEW.id;
END;

INSERT INTO knowledge_chunks_fts (evidence_id, chunk_id, source_id, title, author, content, tags)
SELECT chunk.evidence_id, chunk.id, chunk.source_id, source.title, source.author, chunk.content,
  source.tags_json || ' ' || source.stock_codes_json || ' ' || source.sectors_json
FROM knowledge_chunks AS chunk
JOIN knowledge_sources AS source ON source.id = chunk.source_id
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_chunks_fts AS indexed WHERE indexed.chunk_id = chunk.id
);
