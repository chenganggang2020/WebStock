let settingsBound = false;
const RISK_SETTINGS_KEY = 'webstock_risk_settings';
const DEFAULT_RISK_SETTINGS = { drawdown: 8, dailyDrop: 3, leaderDrop: 3 };
const DEFAULT_LEVEL2_LOGIN_URL = 'https://quantapi.10jqka.com.cn/';

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

function settingsSetLanAccessResult(message, isError) {
  const target = document.getElementById('settingsLanAccessResult');
  if (!target) return;
  target.classList.toggle('error-text', !!isError);
  target.textContent = message || '';
}

function settingsRenderLanAccess(status) {
  const card = document.getElementById('desktopLanAccessCard');
  if (!card) return;
  const supported = !!(status && status.supported);
  card.style.display = supported ? '' : 'none';
  if (!supported) return;

  const enabled = !!status.enabled;
  const urls = Array.isArray(status.pairingUrls) ? status.pairingUrls : [];
  const pairingOptions = Array.isArray(status.pairingOptions) && status.pairingOptions.length
    ? status.pairingOptions
    : urls.map(function(url) { return { url, label: '局域网', kind: 'lan' }; });
  const hasTailscale = pairingOptions.some(function(option) { return option.kind === 'tailscale'; });
  const target = document.getElementById('settingsLanAccessStatus');
  const enableButton = document.getElementById('enableLanAccessBtn');
  const disableButton = document.getElementById('disableLanAccessBtn');
  const copyButton = document.getElementById('copyLanPairingUrlBtn');
  const urlField = document.getElementById('lanPairingUrlField');
  const select = document.getElementById('lanPairingUrlSelect');

  if (target) {
    target.innerHTML = [
      '<div class="settings-status-row">',
      '<span class="status-pill ' + (enabled ? 'good' : 'muted') + '">' + (enabled ? '已开启' : '已关闭') + '</span>',
      '<span>' + (enabled ? '端口 ' + settingsEscapeHtml(status.port) : '仅本机可访问') + '</span>',
      '</div>',
      '<div class="settings-status-detail">',
      enabled
        ? (urls.length
          ? (hasTailscale
            ? '已检测到 Tailscale 远程地址；外出使用请选择该项，同一网络也可选局域网。'
            : '目前只有局域网地址；外出访问需在电脑和手机开启 Tailscale。')
          : '未检测到可用的私有 IPv4 地址，请检查网络或 Tailscale。')
        : '默认关闭；开启后仍需完整配对地址才能从其他设备访问。',
      '</div>'
    ].join('');
  }
  if (select) {
    select.innerHTML = pairingOptions.map(function(option) {
      return '<option value="' + settingsEscapeHtml(option.url) + '">' +
        settingsEscapeHtml(option.label + ' · ' + option.url.replace(/\?pair=.*/, '')) + '</option>';
    }).join('');
  }
  if (enableButton) enableButton.style.display = enabled ? 'none' : '';
  if (disableButton) disableButton.style.display = enabled ? '' : 'none';
  if (urlField) urlField.style.display = enabled && urls.length ? '' : 'none';
  if (copyButton) copyButton.style.display = enabled && urls.length ? '' : 'none';
}

async function settingsLoadLanAccess() {
  if (!window.webstockDesktop || typeof window.webstockDesktop.getLanAccessStatus !== 'function') {
    settingsRenderLanAccess({ supported: false });
    return;
  }
  try {
    settingsRenderLanAccess(await window.webstockDesktop.getLanAccessStatus());
  } catch (error) {
    settingsSetLanAccessResult('手机连接状态读取失败：' + error.message, true);
  }
}

function settingsSetIosAccessResult(message, isError) {
  const target = document.getElementById('settingsIosAccessResult');
  if (!target) return;
  target.classList.toggle('error-text', !!isError);
  target.textContent = message || '';
}

function settingsRenderIosAccess(status) {
  const card = document.getElementById('desktopIosAccessCard');
  if (!card) return;
  const supported = !!(window.webstockDesktop && typeof window.webstockDesktop.getIosAccessStatus === 'function');
  card.style.display = supported ? '' : 'none';
  if (!supported) return;

  const installed = !!(status && status.installed);
  const connected = !!(status && status.connected);
  const enabled = !!(status && status.enabled);
  const target = document.getElementById('settingsIosAccessStatus');
  const installButton = document.getElementById('installTailscaleBtn');
  const loginButton = document.getElementById('loginTailscaleBtn');
  const enableButton = document.getElementById('enableIosAccessBtn');
  const disableButton = document.getElementById('disableIosAccessBtn');
  const copyButton = document.getElementById('copyIosPairingUrlBtn');
  const field = document.getElementById('iosPairingUrlField');
  const input = document.getElementById('iosPairingUrlInput');

  if (target) {
    const badge = enabled ? '已启用' : (connected ? '已连接' : (installed ? '待登录' : '未安装'));
    target.innerHTML = '<div class="settings-status-row"><span class="status-pill ' +
      (enabled || connected ? 'good' : 'muted') + '">' + badge + '</span><span>' +
      (enabled ? '私网 HTTPS 端口 ' + settingsEscapeHtml(status.httpsPort) : 'Tailscale 私网') + '</span></div>' +
      '<div class="settings-status-detail">' +
      (enabled ? '地址已就绪，可在 iPhone Safari 中完成首次配对并添加到主屏幕。' :
        (connected ? '电脑已登录 Tailscale，点击启用即可生成 iPhone 安装地址。' :
          (installed ? '请先从系统托盘登录 Tailscale，再刷新状态。' : '需要先安装 Tailscale。'))) + '</div>';
  }
  if (input) input.value = enabled ? String(status.pairingUrl || '') : '';
  if (field) field.style.display = enabled && status.pairingUrl ? '' : 'none';
  if (installButton) installButton.style.display = installed ? 'none' : '';
  if (loginButton) loginButton.style.display = installed && !connected ? '' : 'none';
  if (enableButton) enableButton.style.display = connected && !enabled ? '' : 'none';
  if (disableButton) disableButton.style.display = enabled ? '' : 'none';
  if (copyButton) copyButton.style.display = enabled && status.pairingUrl ? '' : 'none';
}

async function settingsLoadIosAccess() {
  if (!window.webstockDesktop || typeof window.webstockDesktop.getIosAccessStatus !== 'function') {
    settingsRenderIosAccess(null);
    return;
  }
  try {
    settingsRenderIosAccess(await window.webstockDesktop.getIosAccessStatus());
  } catch (error) {
    settingsSetIosAccessResult('iPhone 连接状态读取失败：' + error.message, true);
  }
}

async function settingsSetIosAccess(enabled) {
  settingsSetIosAccessResult(enabled ? '正在配置私网 HTTPS…' : '正在关闭 iPhone HTTPS…');
  try {
    const status = await window.webstockDesktop.setIosAccessEnabled(enabled === true);
    settingsRenderIosAccess(status);
    if (status && status.approvalRequired) {
      settingsSetIosAccessResult('Tailscale 官方授权页已打开。允许 Serve 后，再点击一次“启用 iPhone HTTPS”。');
      return;
    }
    settingsSetIosAccessResult(enabled ? 'iPhone 安装地址已生成。' : 'iPhone HTTPS 已关闭。');
  } catch (error) {
    settingsSetIosAccessResult(error.message, true);
    await settingsLoadIosAccess();
  }
}

async function settingsBeginTailscaleLogin() {
  if (!window.webstockDesktop || typeof window.webstockDesktop.beginTailscaleLogin !== 'function') return;
  settingsSetIosAccessResult('正在打开 Tailscale 官方登录页…');
  try {
    const result = await window.webstockDesktop.beginTailscaleLogin();
    if (result && result.connected) {
      settingsSetIosAccessResult('Tailscale 已登录，可以启用 iPhone HTTPS。');
      await settingsLoadIosAccess();
      return;
    }
    settingsSetIosAccessResult('官方登录页已打开。完成登录后回到这里，页面会自动刷新状态。');
    let attempts = 0;
    const poll = setInterval(async function() {
      attempts += 1;
      await settingsLoadIosAccess();
      const status = await window.webstockDesktop.getIosAccessStatus().catch(function() { return null; });
      if (status && status.connected || attempts >= 30) clearInterval(poll);
    }, 2000);
  } catch (error) {
    settingsSetIosAccessResult(error.message, true);
  }
}

async function settingsCopyIosPairingUrl() {
  const input = document.getElementById('iosPairingUrlInput');
  if (!input || !input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (_) {
    input.select();
    document.execCommand('copy');
  }
  settingsSetIosAccessResult('iPhone 安装地址已复制。');
}

async function settingsSetLanAccess(enabled) {
  if (!window.webstockDesktop) return;
  settingsSetLanAccessResult(enabled ? '正在开启手机连接...' : '正在关闭手机连接...');
  try {
    const status = await window.webstockDesktop.setLanAccessEnabled(enabled === true);
    settingsRenderLanAccess(status);
    settingsSetLanAccessResult(enabled
      ? (status.pairingUrls.length ? '手机连接已开启，请复制完整配对地址。' : '已开启，但暂未检测到可用局域网地址。')
      : '手机连接已关闭，外部设备已无法访问。');
  } catch (error) {
    settingsSetLanAccessResult('切换失败：' + error.message, true);
    await settingsLoadLanAccess();
  }
}

async function settingsCopyLanPairingUrl() {
  const select = document.getElementById('lanPairingUrlSelect');
  const url = select ? select.value : '';
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch (_) {
    const input = document.createElement('textarea');
    input.value = url;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
  settingsSetLanAccessResult('配对地址已复制。');
}

function settingsSetLevel2Result(message, isError) {
  const target = document.getElementById('settingsLevel2TestResult');
  if (!target) return;
  target.classList.toggle('error-text', !!isError);
  target.textContent = message || '';
}

function settingsLevel2Field(id) {
  return document.getElementById(id);
}

function settingsFillLevel2Form(config) {
  const provider = settingsLevel2Field('level2ProviderInput');
  const loginUrl = settingsLevel2Field('level2LoginUrlInput');
  const baseUrl = settingsLevel2Field('level2BaseUrlInput');
  const apiKey = settingsLevel2Field('level2ApiKeyInput');
  const depthEndpoint = settingsLevel2Field('level2DepthEndpointInput');
  const tradesEndpoint = settingsLevel2Field('level2TradesEndpointInput');
  const threshold = settingsLevel2Field('level2ThresholdInput');
  const volumeUnit = settingsLevel2Field('level2VolumeUnitInput');
  const officialLink = settingsLevel2Field('level2OfficialLoginLink');

  if (provider) provider.value = config.provider || 'disabled';
  if (loginUrl) loginUrl.value = config.loginUrl || DEFAULT_LEVEL2_LOGIN_URL;
  if (baseUrl) baseUrl.value = config.baseUrl || '';
  if (apiKey) apiKey.value = '';
  if (depthEndpoint) depthEndpoint.value = config.depthEndpoint || '/depth?code={code}';
  if (tradesEndpoint) tradesEndpoint.value = config.tradesEndpoint || '/trades?code={code}&limit={limit}';
  if (threshold) threshold.value = config.largeOrderThreshold || 500000;
  if (volumeUnit) volumeUnit.value = config.volumeUnit || 'share';
  if (officialLink) officialLink.href = config.loginUrl || DEFAULT_LEVEL2_LOGIN_URL;
}

function settingsRenderLevel2Status(config) {
  const target = document.getElementById('settingsLevel2Status');
  if (!target) return;
  const configured = !!config.configured;
  const keyText = config.hasApiKey
    ? 'Key: ' + settingsEscapeHtml(config.apiKeyPreview || 'saved')
    : 'Key: not saved';
  target.innerHTML = [
    '<div class="settings-status-row">',
    '<span class="status-pill ' + (configured ? 'good' : 'muted') + '">' + (configured ? 'Configured' : 'Not configured') + '</span>',
    '<span>' + settingsEscapeHtml(config.provider || 'disabled') + '</span>',
    '<span>' + settingsEscapeHtml(config.baseUrl || 'No gateway URL') + '</span>',
    '</div>',
    '<div class="settings-status-detail">',
    keyText + ' · Threshold: ' + settingsEscapeHtml(config.largeOrderThreshold || 500000) +
    ' · Volume unit: ' + settingsEscapeHtml(config.volumeUnit || 'share'),
    '</div>'
  ].join('');
}

async function settingsLoadLevel2Config() {
  const target = document.getElementById('settingsLevel2Status');
  if (target) target.innerHTML = '<span class="muted">Loading...</span>';
  try {
    const config = await window.ApiClient.fetchJsonData('/api/level2/config');
    settingsFillLevel2Form(config);
    settingsRenderLevel2Status(config);
  } catch (error) {
    if (target) target.innerHTML = '<div class="error-text">Level-2 status unavailable: ' + settingsEscapeHtml(error.message) + '</div>';
  }
}

function settingsReadLevel2Form(extra) {
  return Object.assign({
    provider: settingsLevel2Field('level2ProviderInput') ? settingsLevel2Field('level2ProviderInput').value : 'disabled',
    loginUrl: settingsLevel2Field('level2LoginUrlInput') ? settingsLevel2Field('level2LoginUrlInput').value : DEFAULT_LEVEL2_LOGIN_URL,
    baseUrl: settingsLevel2Field('level2BaseUrlInput') ? settingsLevel2Field('level2BaseUrlInput').value : '',
    apiKey: settingsLevel2Field('level2ApiKeyInput') ? settingsLevel2Field('level2ApiKeyInput').value : '',
    depthEndpoint: settingsLevel2Field('level2DepthEndpointInput') ? settingsLevel2Field('level2DepthEndpointInput').value : '/depth?code={code}',
    tradesEndpoint: settingsLevel2Field('level2TradesEndpointInput') ? settingsLevel2Field('level2TradesEndpointInput').value : '/trades?code={code}&limit={limit}',
    largeOrderThreshold: settingsLevel2Field('level2ThresholdInput') ? settingsLevel2Field('level2ThresholdInput').value : 500000,
    volumeUnit: settingsLevel2Field('level2VolumeUnitInput') ? settingsLevel2Field('level2VolumeUnitInput').value : 'share'
  }, extra || {});
}

async function settingsSaveLevel2Config(extra) {
  settingsSetLevel2Result('Saving Level-2 config...');
  try {
    const config = await window.ApiClient.fetchJsonData('/api/level2/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsReadLevel2Form(extra))
    });
    settingsFillLevel2Form(config);
    settingsRenderLevel2Status(config);
    settingsSetLevel2Result('Level-2 config saved. You can now test the gateway.');
  } catch (error) {
    settingsSetLevel2Result('Save failed: ' + error.message, true);
  }
}

async function settingsClearLevel2Key() {
  if (!confirm('Clear saved Level-2 API Key?')) return;
  await settingsSaveLevel2Config({ clearApiKey: true, apiKey: '' });
}

async function settingsTestLevel2CurrentStock() {
  const code = window.State && window.State.currentStock ? window.State.currentStock.code : '000001';
  settingsSetLevel2Result('Testing Level-2 gateway with ' + code + '...');
  try {
    const data = await window.ApiClient.fetchJsonData('/api/level2/large-orders?code=' + encodeURIComponent(code) + '&limit=200');
    const stats = data.stats || {};
    settingsSetLevel2Result(
      'Level-2 OK: ' + data.code +
      ' large trades ' + (stats.largeTradeCount || 0) +
      ', net amount ' + (stats.largeNetAmount || 0) +
      ', ratio ' + ((Number(stats.largeAmountRatio) || 0) * 100).toFixed(2) + '%.'
    );
  } catch (error) {
    settingsSetLevel2Result('Test failed: ' + error.message, true);
  }
}

async function settingsTestFreeFlowCurrentStock() {
  const code = window.State && window.State.currentStock ? window.State.currentStock.code : '000001';
  settingsSetLevel2Result('Fetching free fund-flow estimate for ' + code + '...');
  try {
    const data = await window.ApiClient.fetchJsonData('/api/level2/free-flow?code=' + encodeURIComponent(code));
    settingsSetLevel2Result(
      '免费资金流: ' + data.code + ' ' + (data.name || '') +
      ' 主力净额 ' + (data.mainNetAmount || 0) +
      ', 超大单 ' + (data.superLargeNetAmount || 0) +
      ', 大单 ' + (data.largeNetAmount || 0) +
      ', 模拟大单净额 ' + (data.simulatedLargeNetAmount || 0) +
      ', 主力占比 ' + (Number(data.mainNetRatio || 0)).toFixed(2) + '%.'
    );
  } catch (error) {
    settingsSetLevel2Result('Free flow failed: ' + error.message, true);
  }
}

async function settingsAnalyzeManualLevel2Paste() {
  const textarea = document.getElementById('manualLevel2PasteInput');
  const text = textarea ? textarea.value : '';
  if (!text.trim()) {
    settingsSetLevel2Result('请先粘贴同花顺逐笔成交/成交明细文本。', true);
    return;
  }
  const code = window.State && window.State.currentStock ? window.State.currentStock.code : '000001';
  const thresholdInput = document.getElementById('level2ThresholdInput');
  const volumeUnitInput = document.getElementById('level2VolumeUnitInput');
  settingsSetLevel2Result('Analyzing pasted Level-2 rows...');
  try {
    const data = await window.ApiClient.fetchJsonData('/api/level2/manual-trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        text,
        threshold: thresholdInput ? thresholdInput.value : 500000,
        volumeUnit: volumeUnitInput ? volumeUnitInput.value : 'share'
      })
    });
    settingsSetLevel2Result(
      '粘贴模拟: 解析 ' + data.trades.length +
      ' 笔，超过阈值 ' + data.stats.largeTradeCount +
      ' 笔，大单净额 ' + data.stats.largeNetAmount +
      '，大单占比 ' + ((Number(data.stats.largeAmountRatio) || 0) * 100).toFixed(2) + '%.'
    );
  } catch (error) {
    settingsSetLevel2Result('Manual analysis failed: ' + error.message, true);
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
  await settingsLoadLanAccess();
  await settingsLoadIosAccess();
  await settingsLoadLevel2Config();
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
        'Incoming: watchlist ' + (incoming.watchlist || 0) + ', trades ' + (incoming.trades || 0) + ', sectors ' + (incoming.sectors || 0) + ', leaders ' + (incoming.sectorLeaders || 0) + ', screener tasks ' + (incoming.screenerResults || 0) + ', knowledge sources ' + (incoming.knowledgeSources || 0) + ', research runs ' + (incoming.researchRuns || 0) + ', paper portfolios ' + (incoming.paperPortfolios || 0) + '.',
        'Current: watchlist ' + (current.watchlist || 0) + ', trades ' + (current.trades || 0) + ', sectors ' + (current.sectors || 0) + ', leaders ' + (current.sectorLeaders || 0) + ', screener tasks ' + (current.screenerResults || 0) + ', knowledge sources ' + (current.knowledgeSources || 0) + ', research runs ' + (current.researchRuns || 0) + ', paper portfolios ' + (current.paperPortfolios || 0) + '.',
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
        ', screener tasks ' + (result.screenerResults || 0) +
        ', knowledge sources ' + (result.knowledgeSources || 0) +
        ', research runs ' + (result.researchRuns || 0) +
        ', paper portfolios ' + (result.paperPortfolios || 0) + '.'
      );
      if (window.Watchlist) window.Watchlist.loadWatchlist().catch(function() {});
      if (window.RecentStocks) window.RecentStocks.load(20).catch(function() {});
      if (window.Portfolio) window.Portfolio.loadPortfolio().catch(function() {});
      if (window.Dashboard) window.Dashboard.load().catch(function() {});
      if (window.StockScreener) window.StockScreener.loadHistory().catch(function() {});
      if (window.AIResearch) window.AIResearch.ensureLoaded(true).then(function() {
        if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
      }).catch(function() {});
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

  const enableLanAccess = document.getElementById('enableLanAccessBtn');
  if (enableLanAccess) enableLanAccess.addEventListener('click', function() {
    settingsSetLanAccess(true);
  });

  const disableLanAccess = document.getElementById('disableLanAccessBtn');
  if (disableLanAccess) disableLanAccess.addEventListener('click', function() {
    settingsSetLanAccess(false);
  });

  const copyLanPairingUrl = document.getElementById('copyLanPairingUrlBtn');
  if (copyLanPairingUrl) copyLanPairingUrl.addEventListener('click', settingsCopyLanPairingUrl);

  const installTailscale = document.getElementById('installTailscaleBtn');
  if (installTailscale) installTailscale.addEventListener('click', function() {
    if (window.webstockDesktop) window.webstockDesktop.openTailscaleDownload();
  });

  const loginTailscale = document.getElementById('loginTailscaleBtn');
  if (loginTailscale) loginTailscale.addEventListener('click', settingsBeginTailscaleLogin);

  const enableIosAccess = document.getElementById('enableIosAccessBtn');
  if (enableIosAccess) enableIosAccess.addEventListener('click', function() { settingsSetIosAccess(true); });

  const disableIosAccess = document.getElementById('disableIosAccessBtn');
  if (disableIosAccess) disableIosAccess.addEventListener('click', function() { settingsSetIosAccess(false); });

  const copyIosPairingUrl = document.getElementById('copyIosPairingUrlBtn');
  if (copyIosPairingUrl) copyIosPairingUrl.addEventListener('click', settingsCopyIosPairingUrl);

  const saveRisk = document.getElementById('saveRiskSettingsBtn');
  if (saveRisk) saveRisk.addEventListener('click', settingsSaveRiskSettings);

  const resetRisk = document.getElementById('resetRiskSettingsBtn');
  if (resetRisk) resetRisk.addEventListener('click', settingsResetRiskSettings);

  const level2LoginUrl = document.getElementById('level2LoginUrlInput');
  const level2OfficialLoginLink = document.getElementById('level2OfficialLoginLink');
  if (level2LoginUrl && level2OfficialLoginLink) {
    level2LoginUrl.addEventListener('input', function() {
      level2OfficialLoginLink.href = level2LoginUrl.value || DEFAULT_LEVEL2_LOGIN_URL;
    });
  }

  const refreshLevel2 = document.getElementById('refreshLevel2StatusBtn');
  if (refreshLevel2) refreshLevel2.addEventListener('click', function() {
    settingsLoadLevel2Config().catch(function(error) { settingsSetLevel2Result(error.message, true); });
  });

  const saveLevel2 = document.getElementById('saveLevel2ConfigBtn');
  if (saveLevel2) saveLevel2.addEventListener('click', function() {
    settingsSaveLevel2Config().catch(function(error) { settingsSetLevel2Result(error.message, true); });
  });

  const clearLevel2Key = document.getElementById('clearLevel2KeyBtn');
  if (clearLevel2Key) clearLevel2Key.addEventListener('click', function() {
    settingsClearLevel2Key().catch(function(error) { settingsSetLevel2Result(error.message, true); });
  });

  const testLevel2 = document.getElementById('testLevel2CurrentStockBtn');
  if (testLevel2) testLevel2.addEventListener('click', function() {
    settingsTestLevel2CurrentStock().catch(function(error) { settingsSetLevel2Result(error.message, true); });
  });

  const testFreeFlow = document.getElementById('testFreeFlowCurrentStockBtn');
  if (testFreeFlow) testFreeFlow.addEventListener('click', function() {
    settingsTestFreeFlowCurrentStock().catch(function(error) { settingsSetLevel2Result(error.message, true); });
  });

  const analyzeManual = document.getElementById('analyzeManualLevel2Btn');
  if (analyzeManual) analyzeManual.addEventListener('click', function() {
    settingsAnalyzeManualLevel2Paste().catch(function(error) { settingsSetLevel2Result(error.message, true); });
  });

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
  loadLevel2Config: settingsLoadLevel2Config,
  loadLanAccess: settingsLoadLanAccess,
  loadIosAccess: settingsLoadIosAccess,
  setLanAccess: settingsSetLanAccess,
  setIosAccess: settingsSetIosAccess,
  saveLevel2Config: settingsSaveLevel2Config,
  testLevel2CurrentStock: settingsTestLevel2CurrentStock,
  testFreeFlowCurrentStock: settingsTestFreeFlowCurrentStock,
  analyzeManualLevel2Paste: settingsAnalyzeManualLevel2Paste,
  getRiskSettings: settingsGetRiskSettings,
  saveRiskSettings: settingsSaveRiskSettings,
  resetRiskSettings: settingsResetRiskSettings
};
