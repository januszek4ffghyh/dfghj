const fs=require('fs');
const s=fs.readFileSync('TAJNE.TXT','utf8');

function findCtx(pattern, maxResults, ctxLen){
  maxResults=maxResults||6; ctxLen=ctxLen||200;
  const re=new RegExp(pattern,'g');
  const results=[];
  let m;
  while((m=re.exec(s))!==null && results.length<maxResults){
    const start=Math.max(0,m.index-40);
    const end=Math.min(s.length,m.index+ctxLen);
    results.push(s.substring(start,end).replace(/\s+/g,' ').trim());
  }
  return results;
}

console.log('=== fight API ===');
findCtx('fight.a=[a-z_]+[^"]{0,60}').forEach(r=>console.log(' ',r));

console.log('\n=== talk dialog NPC ===');
findCtx('_g."talk.[^"]{0,80}').forEach(r=>console.log(' ',r));

console.log('\n=== captcha HTML struktura ===');
findCtx('captcha__[a-z]+',6,150).forEach(r=>console.log(' ',r));

console.log('\n=== Engine.captcha functions ===');
findCtx('Engine.captcha.[a-z]+',6,200).forEach(r=>console.log(' ',r));

console.log('\n=== quests actions ===');
findCtx('quests.action=[a-z_]+',6,150).forEach(r=>console.log(' ',r));

console.log('\n=== autoGoTo format ===');
findCtx('autoGoTo.',4,200).forEach(r=>console.log(' ',r));

console.log('\n=== waitForDialog ===');
findCtx('waitForDialog',4,250).forEach(r=>console.log(' ',r));

console.log('\n=== captcha updateData / answer ===');
findCtx('captcha.updateData|captcha.answer|captcha.check',6,250).forEach(r=>console.log(' ',r));

console.log('\n=== API.callEvent nazwy ===');
findCtx('API.callEvent."[a-z_]+"',10,100).forEach(r=>console.log(' ',r));

console.log('\n=== API.Storage ===');
findCtx('API.Storage.[a-z]+',6,150).forEach(r=>console.log(' ',r));

console.log('\n=== Engine.hero.d. properties ===');
const heroProps = new Set();
const re = /Engine\.hero\.d\.(\w+)/g;
let m2;
while((m2=re.exec(s))!==null) heroProps.add(m2[1]);
console.log('hero.d props:', Array.from(heroProps).join(', '));

console.log('\n=== Engine.npcs functions ===');
const npcFns = new Set();
const re2 = /Engine\.npcs\.(\w+)/g;
let m3;
while((m3=re2.exec(s))!==null) npcFns.add(m3[1]);
console.log('Engine.npcs.*:', Array.from(npcFns).join(', '));
