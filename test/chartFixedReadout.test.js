const test = require('node:test');
const assert = require('node:assert/strict');
const theme = require('../js/modules/chartTheme');

function chart() {
  const handlers = new Map(), patches = [];
  return { handlers, patches, on: (name, callback) => handlers.set(name, callback),
    off: (name, callback) => { if (handlers.get(name) === callback) handlers.delete(name); },
    setOption: value => patches.push(value), isDisposed: () => false };
}
test('fixed chart readout starts at latest, follows crosshair and resets without a floating quote box', () => {
  const c = chart();
  theme.bindReadout(c, { labels: ['09:30','09:30:05','09:30:10'], defaultIndex: 1,
    textAt: i => ['price 10','price 11','not recorded'][i] });
  assert.equal(c.patches.at(-1).graphic.style.text, 'price 11');
  c.handlers.get('updateAxisPointer')({ axesInfo: [{axisDim:'x',value:0}] });
  assert.equal(c.patches.at(-1).graphic.style.text, 'price 10');
  c.handlers.get('updateAxisPointer')({ axesInfo: [{axisDim:'x',value:2}] });
  assert.equal(c.patches.at(-1).graphic.style.text, 'not recorded');
  c.handlers.get('globalout')();
  assert.equal(c.patches.at(-1).graphic.style.text, 'price 11');
});
test('rebind removes old callbacks and updates only the selected readout index', () => {
  const c = chart();
  theme.bindReadout(c,{labels:['a','b'],textAt:i=>'old '+i});
  theme.bindReadout(c,{labels:['a','b'],textAt:i=>'new '+i,legendAt:i=>name=>name+': '+i});
  c.handlers.get('updateAxisPointer')({axesInfo:[{axisDim:'x',value:'a'}]});
  assert.equal(c.patches.at(-1).graphic.style.text,'new 0');
  assert.equal(c.patches.at(-1).legend.formatter('MA20'),'MA20: 0');
  const count=c.patches.length;
  c.handlers.get('updateAxisPointer')({axesInfo:[{axisDim:'x',value:'a'}]});
  assert.equal(c.patches.length,count);
  assert.equal(c.handlers.size,2);
});
