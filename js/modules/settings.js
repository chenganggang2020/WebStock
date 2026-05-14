let settingsBound = false;
const RISK_SETTINGS_KEY = 'webstock_risk_settings';
const DEFAULT_RISK_SETTINGS = { drawdown: 8, dailyDrop: 3, leaderDrop: 3 };

function settingsEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function settingsLoadAIStatus() {
  const target = document.getElementById('settingsAiStatus');
  if (!target) return;
  target.innerHTML = '<span class="muted">Loading...</span>';

  try {
    const data = await window.apiFetch('/ai-status');

    const enabled = !!data.enabled;
    const hasKey = !!data.hasApiKey;
    target.innerHTML = [
      '<div class="settings-status-row">',
      '<span class="status-pill ' + (enabled ? 'good' : 'muted') + '">' + (enabled ? 'Enabled' : 'Handoff mode') + '</span>',
      '<span>' + settingsEscapeHtml(data.model || 'No model configured') + '</span>',
      '</div>',
      '<div class="settings-status-detail">',
      enabled && hasKey
        ? 'OpenAI API mode is available. API keys are read from environment/config only and are not stored in the repository.'
        : 'OpenAI API mode is not active. Stock analysis and screener AI explanations can use the ChatGPT handoff window.',
      '</div>'
    ].join('');
  } catch (error) {
    target.innerHTML = '<div class="error-text">AI status unavailable: ' + settingsEscapeHtml(error.message) + '</div>';
  }
}

function settingsSetBackupStatus(message, isError) {
  const target = document.getElementById('settingsBackupStatus');
  if (!target) return;
  target.classList.toggle('error-text', !!isError);
  target.textContent = message || '';
}

function settingsGetRiskSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(RISK_SETTINGS_KEY) || '{}');
    return {
      drawdown: Number(saved.drawdown) > 0 ? Number(saved.drawdown) : DEFAULT_RISK_SETTINGS.drawdown,
      dailyDrop: Number(saved.dailyDrop) > 0 ? Number(saved.dailyDrop) : DEFAULT_RISK_SETTINGS.dailyDrop,
      leaderDrop: Number(saved.leaderDrop) > 0 ? Number(saved.leaderDrop) : DEFAULT_RISK_SETTINGS.leaderDrop
    };
  } catch (error) {
    return Object.assign({}, DEFAULT_RISK_SETTINGS);
  }
}

function settingsRenderRiskSettings() {
  const settings = settingsGetRiskSettings();
  const drawdown = document.getElementById('riskDrawdownInput');
  const dailyDrop = document.getElementById('riskDailyDropInput');
  const leaderDrop = document.getElementById('riskLeaderDropInput');
  if (drawdown) drawdown.value = settings.drawdown;
  if (dailyDrop) dailyDrop.value = settings.dailyDrop;
  if (leaderDrop) leaderDrop.value = settings.leaderDrop;
}

function settingsSaveRiskSettings() {
  const drawdown = Number(document.getElementById('riskDrawdownInput').value);
  const dailyDrop = Number(document.getElementById('riskDailyDropInput').value);
  const leaderDrop = Number(document.getElementById('riskLeaderDropInput').value);
  if (![drawdown, dailyDrop, leaderDrop].every(function(value) { return Number.isFinite(value) && value > 0; })) {
    const status = document.getElementById('settingsRiskStatus');
    if (status) status.textContent = 'Risk thresholds must be positive numbers.';
    return;
  }
  localStorage.setItem(RISK_SETTINGS_KEY, JSON.stringify({ drawdown, dailyDrop, leaderDrop }));
  const status = document.getElementById('settingsRiskStatus');
  if (status) status.textContent = 'Risk thresholds saved.';
  if (window.Dashboard) window.Dashboard.refreshCards();
}

function settingsResetRiskSettings() {
  localStorage.removeItem(RISK_SETTINGS_KEY);
  settingsRenderRiskSettings();
  const status = document.getElementById('settingsRiskStatus');
  if (status) status.textContent = 'Risk thresholds reset to defaults.';
  if (window.Dashboard) window.Dashboard.refreshCards();
}

function settingsRenderSavedResults() {
  const target = document.getElementById('savedHandoffResults');
  if (!target) return;

  let saved = [];
  try {
    saved = window.AIAssistant && typeof window.AIAssistant.getSavedResults === 'function'
      ? window.AIAssistant.getSavedResults()
      : JSON.parse(localStorage.getItem('webstock_ai_handoff_results') || '[]');
  } catch (error) {
    target.innerHTML = '<div class="error-text">Saved handoff results could not be read.</div>';
    return;
  }

  if (!saved.length) {
    target.innerHTML = '<div class="empty-state compact">No saved ChatGPT handoff results yet.</div>';
    return;
  }

  target.innerHTML = saved.slice(0, 20).map(function(item) {
    const savedAt = item.savedAt ? new Date(item.savedAt).toLocaleString() : '--';
    return [
      '<article class="handoff-result-card">',
      '<div class="handoff-result-title">' + settingsEscapeHtml(item.title || 'ChatGPT handoff result') + '</div>',
      '<div class="handoff-result-meta">' + settingsEscapeHtml(savedAt) + '</div>',
      '<p>' + settingsEscapeHtml(item.result || '').slice(0, 360) + '</p>',
      '</article>'
    ].join('');
  }).join('');
}

async function settingsLoad() {
  await settingsLoadAIStatus();
  settingsRenderSavedResults();
  settingsRenderRiskSettings();
}

async function settingsExportUserData() {
  settingsSetBackupStatus('Preparing export...');
  try {
    const data = await window.ApiClient.fetchJsonData('/api/user/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'webstock-backup-' + (window.WebStockTime ? window.WebStockTime.filenameDate() : new Date().toISOString().slice(0, 10)) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    settingsSetBackupStatus('Export ready. The JSON file contains workstation data only, not API keys.');
  } catch (error) {
    settingsSetBackupStatus('Export failed: ' + error.message, true);
  }
}

function settingsDownloadCsvTemplate(type) {
  const templates = {
    watchlist: {
      filename: 'webstock-watchlist-template.csv',
      rows: [
        ['code', 'name', 'group_name', 'note', 'alert_high', 'alert_low'],
        ['000001', 'Ping An Bank', 'Core', 'example note', '20', '8']
      ]
    },
    trades: {
      filename: 'webstock-trades-template.csv',
      rows: [
        ['code', 'name', 'side', 'trade_date', 'price', 'quantity', 'fee', 'note'],
        ['000001', 'Ping An Bank', 'buy', window.WebStockTime ? window.WebStockTime.todayDate() : new Date().toISOString().slice(0, 10), '10.00', '100', '0', 'example note']
      ]
    }
  };
  const template = templates[type];
  if (!template) return;
  const csv = template.rows.map(function(row) {
    return row.map(function(cell) {
      const value = String(cell == null ? '' : cell);
      return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
    }).join(',');
  }).join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = template.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  settingsSetBackupStatus('CSV template downloaded: ' + template.filename);
}

function settingsImportUserDataFromFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function() {
    try {
      const backup = JSON.parse(String(reader.result || '{}'));
      const preview = await window.ApiClient.fetchJsonData('/api/user/import-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup })
      });
      const incoming = preview.incoming || {};
      const current = preview.current || {};
      const message = [
        'Import will replace local WebStock workstation data.',
        'Incoming: watchlist ' + (incoming.watchlist || 0) + ', trades ' + (incoming.trades || 0) + ', sectors ' + (incoming.sectors || 0) + ', leaders ' + (incoming.sectorLeaders || 0) + ', screener tasks ' + (incoming.screenerResults || 0) + '.',
        'Current: watchlist ' + (current.watchlist || 0) + ', trades ' + (current.trades || 0) + ', sectors ' + (current.sectors || 0) + ', leaders ' + (current.sectorLeaders || 0) + ', screener tasks ' + (current.screenerResults || 0) + '.',
        'Continue?'
      ].join('\n');
      if (!confirm(message)) return;
      const result = await window.ApiClient.fetchJsonData('/api/user/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'replace', backup })
      });
      settingsSetBackupStatus(
        'Import complete: watchlist ' + result.watchlist +
        ', trades ' + result.trades +
        ', sectors ' + result.sectors +
        ', leaders ' + result.sectorLeaders +
        ', screener tasks ' + (result.screenerResults || 0) + '.'
      );
      if (window.Watchlist) window.Watchlist.loadWatchlist().catch(function() {});
      if (window.RecentStocks) window.RecentStocks.load(20).catch(function() {});
      if (window.Portfolio) window.Portfolio.loadPortfolio().catch(function() {});
      if (window.Dashboard) window.Dashboard.load().catch(function() {});
      if (window.StockScreener) window.StockScreener.loadHistory().catch(function() {});
    } catch (error) {
      settingsSetBackupStatus('Import failed: ' + error.message, true);
    }
  };
  reader.onerror = function() {
    settingsSetBackupStatus('Import failed: file could not be read.', true);
  };
  reader.readAsText(file);
}

function settingsClearSavedResults() {
  if (!confirm('Clear saved ChatGPT handoff results in this browser?')) return;
  localStorage.removeItem('webstock_ai_handoff_results');
  settingsRenderSavedResults();
  if (window.AIHistory) window.AIHistory.render();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
}

function settingsBind() {
  if (settingsBound) return;
  settingsBound = true;

  const refresh = document.getElementById('refreshSettingsBtn');
  if (refresh) refresh.addEventListener('click', function() {
    settingsLoad().catch(function(error) { alert(error.message); });
  });

  const clear = document.getElementById('clearHandoffResultsBtn');
  if (clear) clear.addEventListener('click', settingsClearSavedResults);

  const saveRisk = document.getElementById('saveRiskSettingsBtn');
  if (saveRisk) saveRisk.addEventListener('click', settingsSaveRiskSettings);

  const resetRisk = document.getElementById('resetRiskSettingsBtn');
  if (resetRisk) resetRisk.addEventListener('click', settingsResetRiskSettings);

  const exportBtn = document.getElementById('exportUserDataBtn');
  if (exportBtn) exportBtn.addEventListener('click', settingsExportUserData);

  const watchlistTemplateBtn = document.getElementById('downloadWatchlistTemplateBtn');
  if (watchlistTemplateBtn) watchlistTemplateBtn.addEventListener('click', function() {
    settingsDownloadCsvTemplate('watchlist');
  });

  const tradesTemplateBtn = document.getElementById('downloadTradesTemplateBtn');
  if (tradesTemplateBtn) tradesTemplateBtn.addEventListener('click', function() {
    settingsDownloadCsvTemplate('trades');
  });

  const importBtn = document.getElementById('importUserDataBtn');
  const fileInput = document.getElementById('importUserDataFile');
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', function() { fileInput.click(); });
    fileInput.addEventListener('change', function() {
      settingsImportUserDataFromFile(fileInput.files && fileInput.files[0]);
      fileInput.value = '';
    });
  }
}

window.Settings = {
  bind: settingsBind,
  load: settingsLoad,
  renderSavedResults: settingsRenderSavedResults,
  clearSavedResults: settingsClearSavedResults,
  exportUserData: settingsExportUserData,
  downloadCsvTemplate: settingsDownloadCsvTemplate,
  importUserDataFromFile: settingsImportUserDataFromFile,
  getRiskSettings: settingsGetRiskSettings,
  saveRiskSettings: settingsSaveRiskSettings,
  resetRiskSettings: settingsResetRiskSettings
};
