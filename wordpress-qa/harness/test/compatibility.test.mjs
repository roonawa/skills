import test from 'node:test';
import assert from 'node:assert/strict';
import {latestWordPress,phpTargetBranch,infoURL,evaluateCompatibility} from '../lib/compatibility.mjs';

const now=new Date('2026-11-04T00:00:00Z');
const target={php:'8.4',wordpress:'6.9'};
const plugin=(extra={})=>({type:'plugin',slug:'contact-form-7',name:'Contact Form 7',version:'6.1',active:true,...extra});
const info=(extra={})=>({slug:'contact-form-7',name:'Contact Form 7',version:'6.1',requires:'6.7',tested:'6.9',requires_php:'7.4',last_updated:'2026-09-01 3:00am GMT',...extra});

test('newest WordPress release is read from the official version API',()=>{
 assert.equal(latestWordPress({offers:[{response:'upgrade',current:'6.9.1'},{response:'autoupdate',current:'6.8.3'}]}),'6.9.1');
 assert.throws(()=>latestWordPress({offers:[]}),/WordPress/);
});

test('newest supported PHP branch is read from the php.net table',()=>{
 const row=(b)=>`<tr><td>${b}</td><td>21 Nov 2024</td><td>31 Dec 2026</td><td>31 Dec 2028</td></tr>`;
 assert.equal(phpTargetBranch(`<table>${row('8.2')}${row('8.4')}${row('8.3')}</table>`),'8.4');
 assert.throws(()=>phpTargetBranch('<table></table>'),/PHP/);
});

test('info URLs only use the official WordPress.org API with an encoded slug',()=>{
 assert.match(infoURL('plugin','contact-form-7'),/^https:\/\/api\.wordpress\.org\/plugins\/info\/1\.2\/\?action=plugin_information&request%5Bslug%5D=contact-form-7/);
 assert.match(infoURL('theme','twentytwentyfive'),/^https:\/\/api\.wordpress\.org\/themes\/info\/1\.2\/\?action=theme_information&request%5Bslug%5D=twentytwentyfive/);
});

test('a plugin that declares support for both targets has no findings',()=>{
 const r=evaluateCompatibility(plugin(),info(),target,now);
 assert.deepEqual(r.findings,[]);assert.equal(r.status,'ok');assert.equal(r.requiresPhp,'7.4');assert.equal(r.tested,'6.9');
});

test('requirements above the target PHP, untested WordPress, stale and closed plugins are findings',()=>{
 const php=evaluateCompatibility(plugin(),info({requires_php:'8.5'}),target,now);
 assert.equal(php.status,'incompatible');assert.match(php.findings[0].title,/PHP 8\.4/);
 const wp=evaluateCompatibility(plugin(),info({tested:'6.7.2'}),target,now);
 assert.equal(wp.status,'caution');assert.match(wp.findings[0].title,/WordPress 6\.9/);
 const stale=evaluateCompatibility(plugin(),info({last_updated:'2023-06-01 1:00pm GMT'}),target,now);
 assert.match(stale.findings.map(f=>f.title).join(),/2年以上/);
 const closed=evaluateCompatibility(plugin(),{error:'closed',name:'Old plugin',closed_date:'2025-01-01'},target,now);
 assert.equal(closed.status,'incompatible');assert.match(closed.findings[0].title,/配布が停止/);
});

test('plugins not listed on WordPress.org need a manual check with the vendor',()=>{
 const r=evaluateCompatibility(plugin({slug:'paid-addon'}),{error:'Plugin not found.'},target,now);
 assert.equal(r.status,'unlisted');assert.match(r.findings[0].title,/配布元/);
});

test('an outdated install is flagged so the plugin is updated before the platform',()=>{
 const r=evaluateCompatibility(plugin({version:'5.9'}),info(),target,now);
 assert.equal(r.status,'ok');assert.equal(r.updateFirst,true);assert.match(r.notes.join(),/先に/);
});

test('themes use the same rules without a tested-up-to value',()=>{
 const r=evaluateCompatibility({type:'theme',slug:'twentytwentyfive',name:'Twenty Twenty-Five',version:'1.3'},{slug:'twentytwentyfive',version:'1.3',requires:'6.7',requires_php:'7.2',last_updated:'2026-08-01'},target,now);
 assert.deepEqual(r.findings,[]);assert.equal(r.tested,null);
});

import {run} from '../lib/checks/software-security.mjs';
import {enrichFailures} from '../lib/failure-explanations.mjs';
test('compatibility check reads plugins and themes from the admin screens and reports findings with plain explanations',async()=>{
 const oldState=process.env.WPQA_UI_ADMIN_STATE,oldFetch=globalThis.fetch;let evidence;const asked=[];
 process.env.WPQA_UI_ADMIN_STATE=JSON.stringify({cookies:[],origins:[]});
 const health='<div id="wpadminbar"></div><button data-clipboard-text="### wp-core ###\nversion: 6.7.1\n### wp-server ###\nphp_version: 8.1.2"></button>';
 const plugins='<div id="wpadminbar"></div><table><tr data-plugin="good/main.php" class="active"><td class="plugin-title"><strong>Good</strong></td><td class="plugin-version-author-uri">Version 2.0 |</td></tr><tr data-plugin="needs-php/main.php"><td class="plugin-title"><strong>Needs PHP</strong></td><td class="plugin-version-author-uri">Version 1.0 |</td></tr><tr data-plugin="paid/main.php"><td class="plugin-title"><strong>Paid</strong></td><td class="plugin-version-author-uri">Version 3.0 |</td></tr></table>';
 const themes='<div id="wpadminbar"></div><script>var _wpThemeSettings = {"themes":[{"id":"twentytwentyfive","name":"Twenty Twenty-Five","version":"1.3","active":true}]};</script>';
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(url,options)=>{asked.push(url);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
  if(url.startsWith('https://api.wordpress.org/core/'))return json({offers:[{current:'6.9.1'}]});
  const slug=decodeURIComponent(new URL(url).search).match(/request\[slug\]=([^&]+)/)?.[1];
  if(slug==='good')return json({slug,version:'2.0',requires:'6.5',tested:'6.9',requires_php:'7.4',last_updated:'2026-10-01 1:00pm GMT'});
  if(slug==='needs-php')return json({slug,version:'1.0',requires:'6.5',tested:'6.9',requires_php:'8.5',last_updated:'2026-10-01 1:00pm GMT'});
  if(slug==='paid')return json({error:'Plugin not found.'},404);
  if(slug==='twentytwentyfive')return json({slug,version:'1.3',requires:'6.7',requires_php:'7.2',last_updated:'2026-08-01'});
  throw Error('unexpected '+url);};
 try{
  await assert.rejects(run({check:{suite:'authz',options:{component:'compatibility',targetPhp:'8.4'}},config:{baseURL:'https://example.test'},requestFactory:{newContext:async()=>({get:async url=>({status:()=>200,text:async()=>url.includes('site-health')?health:url.includes('themes.php')?themes:plugins,dispose:async()=>{}}),dispose:async()=>{}})},attach:async(_,d)=>evidence=d}),/COMPATIBILITY_FINDINGS: 2件/);
  assert.deepEqual(evidence.target,{wordpress:'6.9.1',php:'8.4',source:{wordpress:'https://api.wordpress.org/core/version-check/1.7/',php:'検査設定'}});
  assert.deepEqual(evidence.current,{wordpress:'6.7.1',php:'8.1.2'});
  assert.deepEqual(evidence.results.map(r=>[r.slug,r.status]),[['good','ok'],['needs-php','incompatible'],['paid','unlisted'],['twentytwentyfive','ok']]);
  assert.deepEqual(evidence.unknown,[]);assert(!asked.some(u=>u.includes('php.net')),'target PHP from settings is not fetched');
  const report=enrichFailures({rows:[{id:'check.security-compatibility',title:'プラグイン・テーマの更新互換性（PHP・WordPress）',status:'fail',evidence:['security.json']}]},()=>evidence);
  const failures=report.rows[0].failures;assert.equal(failures.length,2);
  assert.match(failures.map(f=>f.title).join(),/PHP 8\.4 では動作要件を満たしません/);
  assert(!failures.some(f=>/攻撃|CVE/.test(JSON.stringify(f))),'compatibility findings are not described as vulnerabilities');
 }finally{globalThis.fetch=oldFetch;if(oldState===undefined)delete process.env.WPQA_UI_ADMIN_STATE;else process.env.WPQA_UI_ADMIN_STATE=oldState;}
});

import {catalog} from '../lib/config.mjs';
test('compatibility findings are shown as caution (reference check), not as a failure',()=>{
 const check=(id,component,required)=>({id,title:id,suite:'authz',kind:'software-security',required,options:{component}});
 const rows=catalog({baseURL:'https://example.test',pages:[],policies:[],journeys:[],visuals:[],manual:[],checks:[check('compat','compatibility',false),check('plugin','plugin',true),check('compat-required','compatibility',true)]});
 const by=Object.fromEntries(rows.map(r=>[r.id,r]));
 assert.equal(by['check.compat'].level,'caution');assert.equal(by['check.plugin'].level,undefined);assert.equal(by['check.compat-required'].level,undefined);
});
