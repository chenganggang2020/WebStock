const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,web=path.join(root,'web');
const desktop=path.resolve(root,'..');
for(const name of ['indicators','auctionRules','marketSignalModel','sequentialSignalModel'])fs.copyFileSync(path.join(desktop,'js/modules',name+'.js'),path.join(web,'shared',name+'.js'));
const pinyin=require('tiny-pinyin');
for(const name of ['stocks.json','funds.json']){
  const source=JSON.parse(fs.readFileSync(path.join(desktop,name),'utf8'));
  const rows=Array.isArray(source)?source:source.funds||[];
  for(const row of rows){const parts=pinyin.convertToPinyin(String(row.name||''),' ',true).toLowerCase().replace(/yin xing/g,'yin hang').split(/\s+/);row.pinyin=parts.join('');row.initials=parts.map(part=>part[0]||'').join('');}
  fs.writeFileSync(path.join(web,name),JSON.stringify(source));
}
fs.cpSync(web,path.join(root,'android/app/src/main/assets/web'),{recursive:true});
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else files.push({path:path.relative(web,file).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
walk(web);fs.writeFileSync(path.join(root,'source-manifest.json'),JSON.stringify({mode:'independent',version:'2.2.0',date:'2026-10-03',desktopReferenceCommit:'8d67e4d',files},null,2));
console.log(`Bundled ${files.length} local frontend resources. No PC server or database packaged.`);

