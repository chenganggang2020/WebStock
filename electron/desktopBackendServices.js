// All database-backed desktop services belong to the data process, never BrowserWindow's main thread.
function createDesktopBackendServices(config, sessionManager, options = {}) {
  const services = [];
  const timers = [];
  const log = (message, error) => console.log(message, error ? error.message || String(error) : '');
  let serverController, douyinAutoSync, creatorCollectionQueue;
  const smoke = process.env.WEBSTOCK_BUILD_SMOKE_TEST === '1';
  function startService(service) { services.push(service); service.start(); return service; }

  function startDouyinAutoSync() {
    const { createDouyinAutoSync, ensureDouyinSyncJobs } = require('./douyinAutoSync');
    const expertChannels = require('../services/expertChannelService');
    const syncState = require('../services/douyinSyncStateService');
    ensureDouyinSyncJobs(expertChannels, syncState, { intervalMinutes: 10 });
    douyinAutoSync = startService(createDouyinAutoSync({
      sessionManager, channels: expertChannels,
      sources: require('../services/douyinSourceService'),
      transcriber: require('../services/douyinTranscriptService').createDouyinTranscriptService(),
      noteProcessor: require('../services/douyinNoteService').createDouyinNoteService(),
      syncState, maxTranscriptionsPerRun: 3,
      onSessionState: options.onDouyinSessionState,
      shouldDeferChannel: channelId => creatorCollectionQueue && creatorCollectionQueue.hasActiveChannel(channelId), log
    }));
    creatorCollectionQueue = require('../services/creatorCollectionQueue').getCreatorCollectionQueue();
    services.push(creatorCollectionQueue);
    creatorCollectionQueue.start((channelId, settings) => douyinAutoSync.syncChannel(channelId,
      Object.assign({ trigger: 'multi-author' }, settings)), {
      canRun: () => douyinAutoSync.status().runningCount === 0
    });
  }

  function startFullMarketAutoSync() {
    const quant = require('../services/quantService');
    const check = () => {
      try {
        const result = quant.runScheduledFullMarketSync();
        if (result.action === 'started') log('Started scheduled full-market daily increment: ' + result.job.id);
      } catch (error) { log('Scheduled full-market data check failed', error); }
    };
    timers.push(setTimeout(check, 15000), setInterval(check, 5 * 60 * 1000));
    timers.forEach(timer => timer.unref());
  }

  async function start() {
    const { readLanEnabled } = require('../services/lanHostService');
    serverController = require('./lanServerController').createLanServerController({
      expressApp: require('../server'), port: config.port, userDataDir: config.userDataDir, log
    });
    const status = await serverController.start(readLanEnabled(config.userDataDir));
    if (!smoke) {
      startService(require('../services/industryResearchScheduler').createIndustryResearchScheduler({
        service: require('../services/industryResearchService')
      }));
      startService(require('../services/creatorIndustryService').getCreatorIndustryService());
      startService(require('../services/eastmoneyEtfDailyScheduler').createEastmoneyEtfDailyScheduler({
        service: require('../services/eastmoneyEtfDailyService').getEastmoneyEtfDailyService()
      }));
      startService(require('../services/capitalFlow/sectorRotationService').getSectorRotationService());
      if (process.env.WEBSTOCK_LOCAL_SAMPLING_AUTO !== '0') startService(require('../routes/market').localQuoteSampler);
      startService(require('../services/mobilePushService').getMobilePushService());
      startDouyinAutoSync();
      startFullMarketAutoSync();
      startService(require('../services/paperMonitorScheduler').createPaperMonitorScheduler({ log }));
      startService(require('../services/tonghuashunHoldingScheduler').createTonghuashunHoldingScheduler({ log }));
    }
    return { url: 'http://127.0.0.1:' + status.port + '/', pid: process.pid };
  }

  async function stop() {
    timers.forEach(clearTimeout);
    const errors = [];
    // Signal every scheduler before awaiting any long-running task's persistence.
    const results = await Promise.allSettled([...services].reverse().map(service => Promise.resolve().then(() => service.stop())));
    results.forEach(result => { if (result.status === 'rejected') errors.push(result.reason); });
    if (errors.length) throw errors[0];
    if (serverController) await serverController.stop();
    services.length = 0;
  }
  function requireSync() {
    if (!douyinAutoSync) throw new Error('Background collection is not started');
    return douyinAutoSync;
  }
  function setPairingToken(value) {
    if (value) process.env.WEBSTOCK_LAN_TOKEN = value;
    else delete process.env.WEBSTOCK_LAN_TOKEN;
    return true;
  }
  return {
    start, stop,
    commands: {
      lanStatus: () => serverController.status(),
      async setLanEnabled(enabled) {
        const result = await serverController.setEnabled(enabled === true);
        if (!enabled && require('../services/tailscaleAccessService').readTailscaleEnabled(config.userDataDir)) {
          setPairingToken(require('../services/lanHostService').ensurePairingToken(config.userDataDir));
        }
        return result;
      },
      setPairingToken,
      syncAll: () => requireSync().syncAll(),
      syncChannel: (channelId, settings) => requireSync().syncChannel(channelId, settings),
      runVideo: (...args) => requireSync().runVideo(...args)
    }
  };
}

module.exports = { createDesktopBackendServices };
