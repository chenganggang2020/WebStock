const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,web=path.join(root,'web');
// Use the versioned standalone models and indexed catalog in this release.
// Do not overwrite reviewed source from another mutable desktop checkout at build time.
fs.cpSync(web,path.join(root,'android/app/src/main/assets/web'),{recursive:true});
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else files.push({path:path.relative(web,file).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
walk(web);fs.writeFileSync(path.join(root,'source-manifest.json'),JSON.stringify({mode:'independent',version:'2.3.0',date:'2026-10-05',baseline:'runtime-lifecycle-cleanup/android-independent 2.2.0 source',baselineApkSha256:'4C90F7401505299884ED89ECDDC7DE81D10776086A4C8ADF3DD2BCB3B8903EF3',files},null,2));
console.log(`Bundled ${files.length} local frontend resources. No PC server or database packaged.`);

