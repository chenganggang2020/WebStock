const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('legacy slot index upgrades without deleting failed attempts and still permits only one valid decision', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-monitor-index-'));
  const filename = path.join(directory, 'migration.db');
  process.env.WEBSTOCK_DB_PATH = filename;
  const legacy = new Database(filename);
  legacy.exec(fs.readFileSync(path.join(__dirname, '../db/init.sql'), 'utf8'));
  legacy.exec(`DROP INDEX idx_paper_valid_decision_schedule_slot;
    CREATE UNIQUE INDEX idx_paper_decision_schedule_slot ON paper_model_decisions(portfolio_id,schedule_slot) WHERE schedule_slot <> '';
    INSERT INTO paper_portfolios (id,name,status,as_of) VALUES (1,'Migration test','active','2026-09-07T02:30:00Z');
    INSERT INTO paper_model_decisions (portfolio_id,advised_at,market_as_of,model_id,mode,schedule_slot,prompt_hash,prompt_text,raw_response,validation_status)
    VALUES (1,'2026-09-07T02:30:00Z','2026-09-07T02:30:00Z','test','manual','2026-09-07@10:30','hash','prompt','original invalid text','invalid');`);
  legacy.close();
  const upgraded = require('../db');
  try {
    assert.equal(upgraded.prepare('SELECT raw_response FROM paper_model_decisions').get().raw_response, 'original invalid text');
    assert.equal(upgraded.prepare("SELECT name FROM sqlite_master WHERE name='idx_paper_decision_schedule_slot'").get(), undefined);
    const insert = upgraded.prepare(`INSERT INTO paper_model_decisions (portfolio_id,advised_at,market_as_of,model_id,mode,schedule_slot,prompt_hash,prompt_text,raw_response,validation_status)
      VALUES (1,'2026-09-07T02:31:00Z','2026-09-07T02:30:00Z','test','manual','2026-09-07@10:30','hash','prompt',?,?)`);
    insert.run('another invalid text', 'invalid');
    insert.run('corrected response', 'valid');
    assert.throws(() => insert.run('second valid response', 'valid'), /UNIQUE/);
    assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM paper_model_decisions').get().n, 3);
  } finally {
    upgraded.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
