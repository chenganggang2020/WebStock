const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createCreatorCollectionQueue } = require('../services/creatorCollectionQueue');
const { createDouyinAutoSync } = require('../electron/douyinAutoSync');
const { summarizeArchiveQueue } = require('../services/douyinArchiveQueueService');

function makeChannels() {
  const records = new Map([1, 2, 3].map(id => [id, {
    id, displayName: 'Author ' + id, platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/' + id, enabled: true
  }]));
  records.set(4, {
    id: 4, displayName: 'Other', platform: 'weibo',
    profileUrl: 'https://weibo.com/other', enabled: true
  });
  records.set(5, Object.assign({}, records.get(1), {
    id: 5, enabled: false
  }));
  records.set(6, Object.assign({}, records.get(1), {
    id: 6, profileUrl: ''
  }));
  return { getChannel: id => records.get(id) || null };
}

function makeQueue(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  return createCreatorCollectionQueue({ db, channels: makeChannels() });
}

function syncResult(overrides = {}) {
  return Object.assign({
    archive: { complete: true, discoveredCount: 10, reportedWorkCount: 10 },
    archiveQueue: { after: { pendingCount: 0, completedCount: 10 } },
    transcribedCount: 5,
    detailedCount: 5,
    detailErrors: [],
    transcriptErrors: [],
    archiveErrors: []
  }, overrides);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function storedJob(queue, id) {
  const job = queue.list().find(item => item.id === id);
  assert.ok(job, 'the job must remain visible in the persistent queue');
  return job;
}

test('shutdown interrupted incremental work stays resumable and rejects a new retry', async t => {
  const queue = makeQueue(t);
  const [job] = queue.enqueue([1], { mode: 'incremental' });
  const result = await queue.runNext(async () => syncResult({ interrupted: true, remainingCount: 1 }));
  assert.equal(result.status, 'queued');
  await queue.stop();
  assert.throws(() => queue.retry(job.id), /stopping/);
});

test('creator collection accepts all supported models and stores the requested options', t => {
  const queue = makeQueue(t);
  const examples = [
    { channelId: 1, mode: 'archive', model: 'small' },
    { channelId: 2, mode: 'incremental', model: 'large-v3-turbo' },
    { channelId: 3, mode: 'archive', model: 'large-v3' }
  ];

  for (const example of examples) {
    const jobs = queue.enqueue([example.channelId], {
      mode: example.mode, model: example.model
    });
    assert.equal(jobs.length, 1);
    assert.ok(jobs[0].id);
    const stored = storedJob(queue, jobs[0].id);
    assert.equal(stored.channelId, example.channelId);
    assert.equal(stored.mode, example.mode);
    assert.equal(stored.model, example.model);
    assert.equal(stored.status, 'queued');
  }
  assert.equal(queue.list().length, 3);
});

test('duplicate authors reuse their queued job without changing its mode or model', t => {
  const queue = makeQueue(t);
  const original = queue.enqueue([1, 1], {
    mode: 'archive', model: 'large-v3'
  });
  assert.equal(original.length, 1);

  const repeated = queue.enqueue([1, 2, 1], {
    mode: 'incremental', model: 'small'
  });

  assert.equal(repeated.length, 2);
  assert.equal(repeated.find(job => job.channelId === 1).id, original[0].id);
  assert.equal(storedJob(queue, original[0].id).mode, 'archive');
  assert.equal(storedJob(queue, original[0].id).model, 'large-v3');
  assert.equal(queue.list().length, 2);
});

test('invalid authors, models, and modes reject the whole enqueue batch atomically', t => {
  const queue = makeQueue(t);
  queue.enqueue([1], { mode: 'archive', model: 'small' });
  const before = queue.list();

  for (const invalidId of [999, 4, 5, 6]) {
    assert.throws(() => queue.enqueue([2, invalidId], {
      mode: 'archive', model: 'large-v3-turbo'
    }), undefined, invalidId);
    assert.deepEqual(queue.list(), before, invalidId + ' must not partially enqueue author-b');
  }
  for (const options of [
    { mode: 'archive', model: 'unknown-model' },
    { mode: 'unknown-mode', model: 'small' }
  ]) {
    assert.throws(() => queue.enqueue([2, 3], options));
    assert.deepEqual(queue.list(), before);
  }
});

test('concurrent runNext calls never overlap and enqueue reuses a running author', async t => {
  const queue = makeQueue(t);
  const jobs = queue.enqueue([1, 2], {
    mode: 'archive', model: 'large-v3'
  });
  const started = deferred();
  const release = deferred();
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const executor = async (channelId, options) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push({ channelId, options });
    started.resolve(channelId);
    await release.promise;
    active -= 1;
    return syncResult();
  };

  const firstRun = queue.runNext(executor);
  const runningChannelId = await started.promise;
  const runningJob = jobs.find(job => job.channelId === runningChannelId);
  const reused = queue.enqueue([runningChannelId], { mode: 'incremental', model: 'small' });
  assert.equal(reused[0].id, runningJob.id);
  assert.equal(storedJob(queue, runningJob.id).status, 'running');
  assert.equal(storedJob(queue, runningJob.id).mode, 'archive');
  assert.equal(storedJob(queue, runningJob.id).model, 'large-v3');

  const busyRun = queue.runNext(executor);
  release.resolve();
  const [first, busy] = await Promise.all([firstRun, busyRun]);
  assert.equal(first.id, runningJob.id);
  assert.equal(first.status, 'complete');
  assert.equal(busy, null);
  assert.equal(calls.length, 1);
  assert.equal(maxActive, 1);
  assert.deepEqual(calls[0].options, { mode: 'archive', model: 'large-v3', detailLimit: 5 });

  const second = await queue.runNext(executor);
  assert.notEqual(second.id, first.id);
  assert.equal(second.status, 'complete');
  assert.equal(maxActive, 1);
  assert.equal(await queue.runNext(executor), null);
});

test('archive progress queues another bounded batch and completes only after pending reaches zero', async t => {
  const queue = makeQueue(t);
  const [job] = queue.enqueue([1], { mode: 'archive', model: 'large-v3-turbo' });
  const calls = [];
  const first = await queue.runNext(async (channelId, options) => {
    calls.push({ channelId, options });
    return syncResult({ archiveQueue: { after: { pendingCount: 5, completedCount: 5 } } });
  });

  assert.equal(first.id, job.id);
  assert.equal(first.status, 'queued');
  assert.equal(storedJob(queue, job.id).status, 'queued');
  const last = await queue.runNext(async (channelId, options) => {
    calls.push({ channelId, options });
    return syncResult();
  });
  assert.equal(last.id, job.id);
  assert.equal(last.status, 'complete');
  assert.equal(storedJob(queue, job.id).status, 'complete');
  assert.deepEqual(calls, [0, 1].map(() => ({
    channelId: 1, options: { mode: 'archive', model: 'large-v3-turbo', detailLimit: 5 }
  })));
  assert.equal(queue.list().length, 1);
});

test('a stalled archive pauses as partial and explicit retry preserves its requested options', async t => {
  const queue = makeQueue(t);
  const [job] = queue.enqueue([1], { mode: 'archive', model: 'large-v3' });
  await queue.runNext(async () => syncResult({
    archiveQueue: { after: { pendingCount: 5, completedCount: 5 } }
  }));
  const stalled = await queue.runNext(async () => syncResult({
    archiveQueue: { after: { pendingCount: 5, completedCount: 5 } },
    transcribedCount: 0, detailedCount: 5
  }));

  assert.equal(stalled.status, 'partial');
  assert.equal(storedJob(queue, job.id).status, 'partial');
  assert.equal(await queue.runNext(() => assert.fail('partial jobs require explicit retry')), null);
  queue.retry(job.id);
  const retried = storedJob(queue, job.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.mode, 'archive');
  assert.equal(retried.model, 'large-v3');
  const completed = await queue.runNext(async () => syncResult());
  assert.equal(completed.id, job.id);
  assert.equal(completed.status, 'complete');
});

test('zero pending items cannot complete an archive without confirmed discovery completion', async t => {
  for (const archive of [{ complete: false, discoveredCount: 10 }, { discoveredCount: 10 },
    {complete:true,discoveredCount:10}, {complete:true,discoveredCount:10,reportedWorkCount:20}]) {
    const queue = makeQueue(t);
    const [job] = queue.enqueue([1], { mode: 'archive', model: 'small' });
    const result = await queue.runNext(async () => syncResult({ archive }));
    assert.notEqual(result.status, 'complete');
    assert.notEqual(storedJob(queue, job.id).status, 'complete');
  }
});

test('reported collection errors pause as partial and executor exceptions pause as blocked', async t => {
  for (const errorField of ['detailErrors', 'transcriptErrors', 'archiveErrors', 'thrown']) {
    const queue = makeQueue(t);
    const [job] = queue.enqueue([1], { mode: 'archive', model: 'small' });
    const result = await queue.runNext(async () => {
      if (errorField === 'thrown') throw new Error('collection interrupted');
      return syncResult({ [errorField]: [{ contentId: '7930000000000000001', error: 'collection failed' }] });
    });
    const expectedStatus = errorField === 'thrown' ? 'blocked' : 'partial';
    assert.equal(result.status, expectedStatus, errorField);
    assert.equal(storedJob(queue, job.id).status, expectedStatus, errorField);
    assert.equal(await queue.runNext(() => assert.fail('errors must not create an automatic retry loop')), null);
  }
});

test('successful incremental collection finishes one batch even when the full archive remains incomplete', async t => {
  const queue = makeQueue(t);
  const [job] = queue.enqueue([1], { mode: 'incremental', model: 'small' });
  const result = await queue.runNext(async (channelId, options) => {
    assert.equal(channelId, 1);
    assert.deepEqual(options, { mode: 'incremental', model: 'small', detailLimit: 5 });
    return syncResult({
      archive: { complete: false, discoveredCount: 10 },
      archiveQueue: { after: { pendingCount: 5, completedCount: 5 } }
    });
  });

  assert.equal(result.id, job.id);
  assert.equal(result.status, 'complete');
  assert.equal(storedJob(queue, job.id).mode, 'incremental');
  assert.equal(await queue.runNext(() => assert.fail('incremental mode executes only one batch')), null);
});

test('queued and partial jobs cancel immediately and no longer reach the executor', async t => {
  const queue = makeQueue(t);
  const [queued] = queue.enqueue([1], { mode: 'archive', model: 'small' });
  queue.cancel(queued.id);
  assert.equal(storedJob(queue, queued.id).status, 'cancelled');

  const [partial] = queue.enqueue([2], { mode: 'archive', model: 'large-v3' });
  await queue.runNext(async () => syncResult({
    archiveQueue: { after: { pendingCount: 5, completedCount: 5 } }
  }));
  await queue.runNext(async () => syncResult({
    archiveQueue: { after: { pendingCount: 5, completedCount: 5 } },
    transcribedCount: 0, detailedCount: 0
  }));
  assert.equal(storedJob(queue, partial.id).status, 'partial');
  queue.cancel(partial.id);
  assert.equal(storedJob(queue, partial.id).status, 'cancelled');
  assert.equal(await queue.runNext(() => assert.fail('cancelled jobs must not execute')), null);
});

test('cancelling a running job waits for its current batch then suppresses further batches', async t => {
  const queue = makeQueue(t);
  const [job] = queue.enqueue([1], { mode: 'archive', model: 'large-v3-turbo' });
  const started = deferred();
  const release = deferred();
  const running = queue.runNext(async () => {
    started.resolve();
    await release.promise;
    return syncResult({ archiveQueue: { after: { pendingCount: 5, completedCount: 5 } } });
  });
  await started.promise;

  queue.cancel(job.id);
  assert.equal(storedJob(queue, job.id).status, 'running');
  assert.equal(storedJob(queue, job.id).cancelRequested, true);
  release.resolve();
  const cancelled = await running;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(storedJob(queue, job.id).status, 'cancelled');
  assert.equal(await queue.runNext(() => assert.fail('cancellation must suppress the next archive batch')), null);
});

test('jobs survive database reopen and interrupted running jobs recover only when explicitly requested', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-creator-queue-'));
  const filename = path.join(directory, 'queue.db');
  const connections = [];
  t.after(() => {
    for (const connection of connections) {
      if (connection.open) connection.close();
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const db = new Database(filename);
  connections.push(db);
  const queue = createCreatorCollectionQueue({ db, channels: makeChannels() });
  const [interrupted] = queue.enqueue([1], { mode: 'archive', model: 'large-v3' });
  const started = deferred();
  // An unsettled executor models a worker exiting before it can persist its result.
  queue.runNext(() => {
    started.resolve();
    return new Promise(() => {});
  });
  await started.promise;
  const [waiting] = queue.enqueue([2], { mode: 'incremental', model: 'small' });
  db.close();

  const reopenedDb = new Database(filename);
  connections.push(reopenedDb);
  const reopened = createCreatorCollectionQueue({ db: reopenedDb, channels: makeChannels() });
  assert.equal(reopened.list().length, 2);
  assert.equal(storedJob(reopened, interrupted.id).status, 'running');
  assert.equal(storedJob(reopened, interrupted.id).model, 'large-v3');
  assert.equal(storedJob(reopened, waiting.id).status, 'queued');
  assert.equal(storedJob(reopened, waiting.id).mode, 'incremental');

  reopened.recoverInterrupted();
  assert.equal(storedJob(reopened, interrupted.id).status, 'queued');
  assert.equal(storedJob(reopened, interrupted.id).mode, 'archive');
  assert.equal(storedJob(reopened, waiting.id).status, 'queued');
});

test('archive collection must not finish while older videos outside the 1000-row observation page remain pending', async t => {
  const queue = makeQueue(t);
  const channel = makeChannels().getChannel(1);
  const observations = Array.from({ length: 1006 }, (_, index) => {
    const contentId = String(7940000000000000000n + BigInt(index));
    return {
      externalContentId: contentId,
      externalKey: contentId,
      sourceUrl: 'https://www.douyin.com/video/' + contentId,
      title: 'Video ' + index,
      mediaType: 'video', evidenceLevel: 'primary',
      localAssetPath: 'D:/test-media/' + contentId + '.mp4',
      transcript: index < 1000 ? 'Previously completed transcript' : '',
      mediaMetadata: {
        detailCapturedAt: '2026-09-01T00:00:00.000Z',
        asr: index < 1000 ? { status: 'complete' } : {}
      }
    };
  });
  const profileCapture = {
    pageType: 'profile', pageUrl: channel.profileUrl, loggedIn: true,
    profile: { displayName: channel.displayName, profileUrl: channel.profileUrl, workCount: 1006 },
    archive: { complete: true, discoveredCount: 1006, reportedWorkCount: 1006 },
    items: observations.map(item => ({
      contentId: item.externalContentId, sourceUrl: item.sourceUrl, title: item.title
    }))
  };
  const sync = createDouyinAutoSync({
    channels: {
      getChannel: () => channel,
      // Match the public listObservations limit; latest 1000 are complete, older six are not.
      listObservations: (_id, options = {}) => observations.slice(0, Math.min(options.limit || 200, 1000)),
      listCollectionObservations: () => observations.slice()
    },
    sessionManager: {
      captureProfileArchive: async () => profileCapture,
      captureUrl: async url => ({
        pageType: 'video', pageUrl: url, loggedIn: true, profile: profileCapture.profile,
        items: profileCapture.items.filter(item => item.sourceUrl === url)
      })
    },
    sources: {
      verifyCapturedIdentity: () => ({ matched: true }),
      importCapturedPage: (_id, capture) => ({
        addedCount: 0, updatedCount: 0, unchangedCount: capture.items.length,
        items: observations.filter(item => capture.items.some(captured => captured.contentId === item.externalContentId))
      }),
      applyTranscription(_id, contentId, result) {
        const item = observations.find(observation => observation.externalContentId === contentId);
        item.transcript = result.transcript;
        item.mediaMetadata.asr = { status: 'complete' };
      }
    },
    transcriber: { transcribe: async () => ({ status: 'complete', transcript: 'New transcript' }) },
    syncState: {
      markRunning() {}, markCompleted() {}, markFailed() {}, getJob: () => ({ lastResult: {} })
    }
  });
  const [job] = queue.enqueue([channel.id], { mode: 'archive', model: 'large-v3' });
  const result = await queue.runNext((channelId, options) => sync.syncChannel(channelId, options));

  assert.equal(result.result.transcribedCount, 5);
  assert.equal(summarizeArchiveQueue(observations).pendingCount, 1);
  assert.equal(result.result.archiveQueue.after.pendingCount, 1);
  assert.equal(result.status, 'queued', 'a complete 1000-row page must not certify the full creator archive');
  assert.equal(storedJob(queue, job.id).status, 'queued');
  const completed = await queue.runNext((channelId, options) => sync.syncChannel(channelId, options));
  assert.equal(completed.result.transcribedCount, 1);
  assert.equal(summarizeArchiveQueue(observations).pendingCount, 0);
  assert.equal(completed.status, 'complete');
});

test('internal collection reads all author observations while the public list remains capped', t => {
  process.env.WEBSTOCK_DB_PATH = ':memory:';
  const db = require('../db');
  const channels = require('../services/expertChannelService');
  t.after(() => db.close());
  const owner = channels.createChannel({
    displayName: 'Large archive', platform: 'douyin', profileUrl: 'https://www.douyin.com/user/large-archive'
  });
  const other = channels.createChannel({
    displayName: 'Other archive', platform: 'douyin', profileUrl: 'https://www.douyin.com/user/other-archive'
  });
  db.transaction(() => {
    for (let index = 0; index < 1002; index++) {
      channels.recordObservation(owner.id, { externalKey: 'video-' + index, title: 'Video ' + index });
    }
    channels.recordObservation(other.id, { externalKey: 'other-video', title: 'Other video' });
  })();

  const full = channels.listCollectionObservations(owner.id);
  assert.equal(full.length, 1002);
  assert.ok(full.every(item => item.channelId === owner.id));
  assert.ok(full.every(item => !Object.hasOwn(item, 'commentData') && !Object.hasOwn(item, 'comments')));
  assert.equal(channels.listObservations(owner.id, { limit: 10000 }).length, 1000);
  assert.deepEqual(full.slice(0, 1000).map(item => item.id),
    channels.listObservations(owner.id, { limit: 1000 }).map(item => item.id));
});
