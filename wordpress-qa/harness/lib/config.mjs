import {validateChecks,suites as extendedSuites} from './checks/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fail = message => { throw new Error(message); };
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: object required`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`Unknown ${label}.${key}`);
}
function string(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label}: nonempty string required`); }
function bool(value, label) { if (typeof value !== 'boolean') fail(`${label}: boolean required`); }
function list(value, label) { if (!Array.isArray(value)) fail(`${label}: array required`); }
function integer(value, min, max, label) { if (!Number.isInteger(value) || value < min || value > max) fail(`${label}: integer ${min}..${max} required`); }
function strings(value, label) { list(value,label); value.forEach(x=>string(x,label)); }
function url(value, label) {
  string(value,label); let parsed; try { parsed = new URL(value); } catch { fail(`${label}: absolute URL required`); }
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail(`${label}: HTTP(S), no credentials required`);
  return parsed;
}
export function sameOrigin(value, base) {
  const u = new URL(value, base);
  if (!['http:','https:'].includes(u.protocol) || u.origin !== new URL(base).origin || u.username || u.password) fail(`URL must have same origin: ${value}`);
  u.hash = ''; return u.href;
}
export function validateConfig(input) {
  const c = structuredClone(input);
  object(c,['name','baseURL','environment','allowProductionJourneys','timeoutMs','pages','policies','journeys','visuals','manual','mailpit','headersEnv','outputDir','baselineDir','revision','admin','checks','allowTestWrites','trustedAdapters'],'config');
  string(c.name,'name'); const base = url(c.baseURL,'baseURL');
  if (base.pathname !== '/' || base.search || base.hash) fail('baseURL must be an origin without a path');
  c.baseURL = base.origin;
  if (!['local','staging','production'].includes(c.environment)) fail('environment must be local/staging/production');
  c.timeoutMs ??= 15000; integer(c.timeoutMs,1000,120000,'timeoutMs');
  c.allowProductionJourneys ??= false; bool(c.allowProductionJourneys,'allowProductionJourneys');
  for (const key of ['headersEnv','outputDir','baselineDir','revision']) if(c[key]!==undefined) string(c[key],key);
  for (const key of ['pages','policies','journeys','visuals','manual','admin']) { c[key] ??= []; list(c[key],key); }
  if (!c.pages.length) fail('pages: at least one explicit page required');
  const ids = new Set();
  function entry(e, keys, type) {
    object(e,['id','required',...keys],type);
    if(typeof e.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(e.id)) fail(`${type}.id: lowercase slug required`);
    const id = `${type}.${e.id}`; if(ids.has(id)) fail(`Duplicate id: ${id}`); ids.add(id);
    e.required ??= true; bool(e.required,`${id}.required`);
  }
  for(const p of c.pages) {
    entry(p,['path','indexable','canonical','title','description','lang','links','template','reason'],'page');
    string(p.path,'page.path'); sameOrigin(p.path,c.baseURL); bool(p.indexable,'page.indexable'); url(p.canonical,'page.canonical');
    for(const k of ['title','description','lang','template','reason']) if(p[k]!==undefined) string(p[k],`page.${k}`);
    p.links ??= true; bool(p.links,'page.links');
  }
  for(const p of c.policies) {
    entry(p,['path','statuses','location','forbiddenText','requiredHeaders'],'policy');
    string(p.path,'policy.path'); sameOrigin(p.path,c.baseURL); list(p.statuses,'policy.statuses');
    if(!p.statuses.length) fail('policy.statuses cannot be empty'); p.statuses.forEach(x=>integer(x,100,599,'status'));
    if(p.statuses.some(x=>x>=300&&x<400) && !p.location) fail('redirect policy requires exact location');
    if(p.location!==undefined) {string(p.location,'location');url(new URL(p.location,c.baseURL).href,'location');}
    p.forbiddenText ??= []; strings(p.forbiddenText,'forbiddenText');
    p.requiredHeaders ??= {}; if(!p.requiredHeaders || Array.isArray(p.requiredHeaders) || typeof p.requiredHeaders!=='object') fail('requiredHeaders must be an object');
    Object.values(p.requiredHeaders).forEach(x=>string(x,'header expected value'));
  }
  for(const j of c.journeys) {
    entry(j,['module','title','reason'],'journey'); string(j.module,'journey.module');
    if(j.title!==undefined) string(j.title,'journey.title');
    if(j.reason!==undefined) string(j.reason,'journey.reason');
  }
  if(c.environment==='production' && c.journeys.length && !c.allowProductionJourneys) fail('production journeys require allowProductionJourneys=true');
  for(const v of c.visuals) {
    entry(v,['pageId','width','height','ready','mask','maxDiffPixels','axe','reason'],'visual');
    if(!c.pages.some(p=>p.id===v.pageId)) fail(`visual.pageId not found: ${v.pageId}`);
    integer(v.width,240,3840,'visual.width'); integer(v.height,240,2160,'visual.height');
    string(v.ready,'visual.ready'); v.mask ??= []; strings(v.mask,'visual.mask');
    if(v.reason!==undefined) string(v.reason,'visual.reason');
    v.maxDiffPixels ??= 0; integer(v.maxDiffPixels,0,100000,'maxDiffPixels'); v.axe ??= true; bool(v.axe,'visual.axe');
  }
  for(const a of c.admin) {
    entry(a,['title','source','path','field','expected','sensitive','headersEnv','storageStateEnv','selector','read','authenticatedSelector'],'admin');
    string(a.title??a.id,'admin.title');string(a.path,'admin.path');sameOrigin(a.path,c.baseURL);
    if(!['rest','browser'].includes(a.source))fail('admin.source must be rest/browser');
    if(a.expected===undefined||a.expected===null||!['string','number','boolean'].includes(typeof a.expected))fail('admin.expected must be an explicit scalar');
    a.sensitive??=false;bool(a.sensitive,'admin.sensitive');
    for(const key of ['headersEnv','storageStateEnv'])if(a[key]!==undefined)string(a[key],key);
    if(a.source==='rest'){string(a.field,'admin.field');if(a.selector!==undefined||a.read!==undefined||a.storageStateEnv!==undefined||a.authenticatedSelector!==undefined)fail('REST setting cannot use browser fields');}
    else {string(a.selector,'admin.selector');string(a.authenticatedSelector,'admin.authenticatedSelector');if(!['value','checked','text'].includes(a.read))fail('admin.read required');if(a.read==='checked'&&typeof a.expected!=='boolean')fail('checked expected must be boolean');if(a.read!=='checked'&&typeof a.expected!=='string')fail('value/text expected must be string');if(a.field!==undefined||a.headersEnv!==undefined)fail('browser setting cannot use REST fields');}
    if(c.environment!=='local'&&new URL(c.baseURL).protocol!=='https:')fail('admin checks require HTTPS outside local fixtures');
  }
  for(const m of c.manual) { entry(m,['title','reason','status'],'manual'); string(m.title,'manual.title'); string(m.reason,'manual.reason'); m.status ??= 'review'; if(!['review','not_applicable'].includes(m.status)) fail('manual status must be review/not_applicable'); }
  if(c.mailpit!==undefined) {
    object(c.mailpit,['url','headersEnv'],'mailpit'); url(c.mailpit.url,'mailpit.url');
    if(c.mailpit.headersEnv!==undefined) string(c.mailpit.headersEnv,'mailpit.headersEnv');
  }
  return validateChecks(c);
}
export function loadConfig(file) {
  const absolute = path.resolve(file);
  const config = validateConfig(JSON.parse(fs.readFileSync(absolute,'utf8').replace(/^\uFEFF/,'')));
  return { config, configPath:absolute, configDir:path.dirname(absolute), configHash:createHash('sha256').update(JSON.stringify(config)).digest('hex') };
}
export function catalog(c, suite='all') {
  if(!['all','audit','journey','visual','admin',...Object.keys(extendedSuites)].includes(suite)) fail(`Unknown suite: ${suite}`);
  const rows=[];
  const add=(id,kind,title,required)=>rows.push({id,suite:kind,title,required,status:'not_run',selected:suite==='all'||suite===kind,reason:'未実行'});
  for(const p of c.pages) { add(`page.${p.id}`,'audit',`${p.path}: HTTP / metadata`,p.required); if(p.links) add(`links.${p.id}`,'audit',`${p.path}: internal links`,p.required); }
  for(const p of c.policies) add(`policy.${p.id}`,'audit',p.path,p.required);
  for(const j of c.journeys) add(`journey.${j.id}`,'journey',j.title??j.id,j.required);
  for(const a of c.admin??[])add('admin.'+a.id,'admin',a.title??a.id,a.required);
  for(const v of c.visuals) {
    add(`layout.${v.id}`,'visual',`${v.pageId}: ${v.width}px layout`,v.required);
    add(`snapshot.${v.id}`,'visual',`${v.pageId}: ${v.width}px screenshot`,v.required);
    if(v.axe) add(`axe.${v.id}`,'visual',`${v.pageId}: ${v.width}px accessibility`,v.required);
  }
  for(const check of c.checks??[]) {add('check.'+check.id,check.suite,check.title,check.required);Object.assign(rows.at(-1),{kind:check.kind,manualReview:check.kind==='human-review',instructions:check.options.instructions});}
  for(const m of c.manual) rows.push({id:`manual.${m.id}`,suite:'manual',manualReview:true,title:m.title,required:m.required,status:m.status,reason:m.reason,selected:false});
  return rows;
}
