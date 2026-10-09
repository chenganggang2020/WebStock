const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const cli='C:/Users/25680/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/@playwright/cli/playwright-cli.js';
const name=process.argv[2]||'app-flow-browser',code=fs.readFileSync(path.join(__dirname,name+'.js'),'utf8');
const result=cp.spawnSync(process.execPath,[cli,'-s=independent20261005','run-code',code],{cwd:path.resolve(__dirname,'../../..'),encoding:'utf8',windowsHide:true,timeout:180000});
const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(path.join(__dirname,name+'.log'),log);const match=log.match(/### Result\s*\n(\{[^\n]+\})/);const report=match?JSON.parse(match[1]):null;if(report)fs.writeFileSync(path.join(__dirname,name+'-results.json'),JSON.stringify(report,null,2));console.log(report||log.slice(0,4000));process.exitCode=result.status||(!report||report.pass!==report.total?1:0);
