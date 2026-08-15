const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('manual sector role is rendered as an unverified observation candidate', () => {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'sectorLeaders.js'), 'utf8'),
    context
  );

  const html = context.window.SectorLeaders.renderCandidateRow({
    id: 1,
    code: '300750',
    name: '宁德时代',
    role: '总龙头',
    price: 238.5,
    change: 4.2,
    amount: 100000000,
    strength: '强',
    note: '人工维护'
  });

  assert.match(html, /data-sector-watch-candidate/);
  assert.match(html, /总龙头（人工标注，未核验）/);
  assert.doesNotMatch(html, /自动确认|系统确认/);
});

test('sector dashboard escapes persisted fields before assigning innerHTML', async () => {
  const dashboardBox = {};
  const context = {
    window: {
      apiFetch: async () => ({
        sectors: [{
          id: '1\" onmouseover=\"alert(1)',
          name: '<img src=x onerror=alert(1)>',
          description: '<script>alert(2)</script>',
          status: '\" autofocus onfocus=alert(3) x=\"',
          leaders: [{
            id: '2\" onclick=\"alert(4)',
            code: '\" onfocus=alert(5) x=\"',
            name: '<img src=x onerror=alert(6)>',
            role: '<script>alert(7)</script>',
            strength: '<img src=x onerror=alert(8)>',
            note: '<script>alert(9)</script>',
            price: 1,
            change: 1,
            amount: 1
          }]
        }],
        overview: []
      }),
      State: { allStocks: [], watchlist: [], recentStocks: [], positions: [] }
    },
    document: {
      getElementById(id) {
        if (id === 'sectorDashboard') return dashboardBox;
        if (id === 'sectorSortSelect') return { value: 'change' };
        return null;
      },
      querySelectorAll() { return []; }
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'sectorLeaders.js'), 'utf8'),
    context
  );

  await context.window.SectorLeaders.load();

  assert.doesNotMatch(dashboardBox.innerHTML, /<\/?(?:img|script)\b/i);
  assert.doesNotMatch(dashboardBox.innerHTML, /data-(?:code|leader-id|sector-id)="[^"]*"\s+on/i);
  assert.match(dashboardBox.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(dashboardBox.innerHTML, /&lt;script&gt;alert\(9\)&lt;\/script&gt;/);
  assert.match(dashboardBox.innerHTML, /<div class="sector-table-scroll"><table/);
});

test('sector snapshot CSV neutralizes spreadsheet formulas after control whitespace', () => {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'sectorLeaders.js'), 'utf8'),
    context
  );

  assert.equal(context.window.SectorLeaders.serializeCsvCell('=1+1'), '"\'=1+1"');
  assert.equal(context.window.SectorLeaders.serializeCsvCell('\t+cmd'), '"\'\t+cmd"');
  assert.equal(context.window.SectorLeaders.serializeCsvCell('\r\n@SUM(A1)'), '"\'\r\n@SUM(A1)"');
  assert.equal(context.window.SectorLeaders.serializeCsvCell('-42'), '"\'-42"');
  assert.equal(context.window.SectorLeaders.serializeCsvCell(-42), '"-42"');
  assert.equal(context.window.SectorLeaders.serializeCsvCell('safe "quote"'), '"safe ""quote"""');
});

test('all sector leader detail tables use a local horizontal scroll container', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'sectorLeaders.js'), 'utf8');
  assert.equal((source.match(/class="sector-table-scroll"/g) || []).length, 4);
});
