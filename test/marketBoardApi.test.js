const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function loadRouter() {
  try {
    return require('../routes/marketBoards').createMarketBoardRouter;
  } catch (error) {
    assert.fail('market board router is not implemented: ' + error.message);
  }
}

function requestJson(server, requestPath) {
  return new Promise(function(resolve, reject) {
    const request = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath
    }, function(response) {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (error) {}
        resolve({ status: response.statusCode, json, body });
      });
    });
    request.on('error', reject);
  });
}

async function withServer(service, callback) {
  const app = express();
  app.use('/api', loadRouter()({ service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await callback(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('market board catalog and snapshot routes forward bounded read-only filters', async () => {
  const calls = [];
  const service = {
    fetchCatalog: async input => {
      calls.push(['catalog', input]);
      return { status: 'available', taxonomy: input.taxonomy, items: [] };
    },
    fetchSnapshot: async input => {
      calls.push(['snapshot', input]);
      return { status: 'available', taxonomy: input.taxonomy, items: [] };
    }
  };

  await withServer(service, async server => {
    const catalog = await requestJson(server, '/api/market/boards/catalog?taxonomy=concept&q=AI&refresh=1');
    const snapshot = await requestJson(server, '/api/market/boards/snapshot?taxonomy=industry&refresh=1');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.json.success, true);
    assert.equal(snapshot.status, 200);
    assert.deepEqual(calls, [
      ['catalog', { taxonomy: 'concept', query: 'AI', refresh: true }],
      ['snapshot', { taxonomy: 'industry', refresh: true }]
    ]);
  });
});

test('market board routes reject unknown taxonomies before invoking providers', async () => {
  let calls = 0;
  const service = {
    fetchCatalog: async () => { calls += 1; },
    fetchSnapshot: async () => { calls += 1; }
  };

  await withServer(service, async server => {
    const result = await requestJson(server, '/api/market/boards/catalog?taxonomy=not-a-taxonomy');
    assert.equal(result.status, 400);
    assert.equal(result.json.success, false);
    assert.equal(result.json.error.code, 'MARKET_BOARD_TAXONOMY_INVALID');
    assert.equal(calls, 0);
  });
});

test('market board constituents route forwards one validated board identity without limiting members', async () => {
  const calls = [];
  const members = Array.from({ length: 135 }, function(_, index) {
    return { code: String(600001 + index), name: '成分股' + (index + 1) };
  });
  const service = {
    fetchCatalog: async () => ({ status: 'available', items: [] }),
    fetchSnapshot: async () => ({ status: 'available', items: [] }),
    fetchConstituents: async input => {
      calls.push(input);
      return {
        status: 'available',
        taxonomy: input.taxonomy,
        board: { code: input.code, name: '半导体' },
        coverageComplete: true,
        items: members
      };
    }
  };

  await withServer(service, async server => {
    const result = await requestJson(
      server,
      '/api/market/boards/constituents?code=BK0475&taxonomy=industry&refresh=1'
    );

    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.deepEqual(calls, [{ code: 'BK0475', taxonomy: 'industry', refresh: true }]);
    assert.equal(result.json.data.items.length, 135);
    assert.equal(result.json.data.items[134].name, '成分股135');
  });
});

test('market board constituents route accepts a strict Sina fallback node identity', async () => {
  const calls = [];
  const service = {
    fetchCatalog: async () => ({ status: 'available', items: [] }),
    fetchSnapshot: async () => ({ status: 'available', items: [] }),
    fetchConstituents: async input => { calls.push(input); return { status: 'available', items: [] }; }
  };

  await withServer(service, async server => {
    const result = await requestJson(
      server,
      '/api/market/boards/constituents?code=new_dzxx&taxonomy=industry'
    );

    assert.equal(result.status, 200);
    assert.deepEqual(calls, [{ code: 'new_dzxx', taxonomy: 'industry', refresh: false }]);
  });
});

test('market board constituents route rejects malformed code, taxonomy and refresh before service access', async () => {
  let calls = 0;
  const service = {
    fetchCatalog: async () => ({ status: 'available', items: [] }),
    fetchSnapshot: async () => ({ status: 'available', items: [] }),
    fetchConstituents: async () => { calls += 1; }
  };

  await withServer(service, async server => {
    const malformedCode = await requestJson(
      server,
      '/api/market/boards/constituents?code=..%2FBK0475&taxonomy=industry'
    );
    const wrongTaxonomy = await requestJson(
      server,
      '/api/market/boards/constituents?code=BK0475&taxonomy=index'
    );
    const wrongRefresh = await requestJson(
      server,
      '/api/market/boards/constituents?code=BK0475&taxonomy=industry&refresh=yes'
    );

    assert.equal(malformedCode.status, 400);
    assert.equal(malformedCode.json.error.code, 'MARKET_BOARD_CODE_INVALID');
    assert.equal(wrongTaxonomy.status, 400);
    assert.equal(wrongTaxonomy.json.error.code, 'MARKET_BOARD_TAXONOMY_INVALID');
    assert.equal(wrongRefresh.status, 400);
    assert.equal(wrongRefresh.json.error.code, 'MARKET_BOARD_REFRESH_INVALID');
    assert.equal(calls, 0);
  });
});
