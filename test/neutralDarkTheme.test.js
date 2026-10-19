const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chart = require('../js/modules/chartTheme');

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v,16)/255)
    .map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
  return rgb[0]*0.2126 + rgb[1]*0.7152 + rgb[2]*0.0722;
}
test('dark shell and charts share neutral surfaces and readable primary/secondary text', () => {
  for (const file of ['fixed-workspace.css','compact-terminal.css']) {
    const css = fs.readFileSync(path.join(__dirname,'../css',file),'utf8');
    const block = css.match(/body\.compact-terminal(?:\.fixed-terminal)?\.dark\s*\{([^}]+)/)[1];
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map(m => [m[1],m[2]]));
    for (const name of ['bg','card-bg','muted-bg','border','hover','active']) {
      const channels = tokens[name].slice(1).match(/../g);
      assert.equal(new Set(channels).size,1,`${file} ${name} is neutral`);
    }
    for (const foreground of ['text','text-secondary']) for (const background of ['bg','card-bg','muted-bg','active']) {
      assert.ok((luminance(tokens[foreground])+0.05)/(luminance(tokens[background])+0.05) >= 4.5, `${foreground} on ${background}`);
    }
    assert.equal(tokens['chart-bg'],chart.get(true).colors.background);
  }
});
