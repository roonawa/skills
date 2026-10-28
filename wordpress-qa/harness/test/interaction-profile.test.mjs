import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInteractionSettings,generateInteractionChecks,interactionMissingConditions,preparationSummary} from '../ui/public/interaction-profile.js';
import {validateProfile,registrationConfig,profileJourneys} from '../ui/registration.mjs';
import {readSettings} from '../builtin/wordpress-profile/helpers.mjs';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,sitePath:'/shop/',writes:true};
const config={baseURL:'https://example.test',environment:'staging',allowTestWrites:true,pages:[{path:'/shop/'},{path:'/shop/product?x=1'}],checks:[]};

test('preparation summary distinguishes optional scope, placeholders and selected incomplete operations without mutation',()=>{
 const source={...config,checks:[{id:'pending',title:'Expected behavior',kind:'unconfigured'},{id:'human',title:'Reading order',kind:'human-review'}]};
 const before=structuredClone(source),settings={enabled:['all-links','menu']};
 const result=preparationSummary(source,undefined,settings);
 assert.deepEqual(result.automatic.map(x=>x.id),['interaction-all-links']);
 assert.deepEqual(result.additional.map(x=>x.id),['interaction-menu','pending']);
 assert.deepEqual(result.manual.map(x=>x.id),['human']);
 assert(result.additional[0].missing.includes('menu.openedValue'));
 assert(!result.additional.some(x=>x.id==='interaction-search-product'));
 assert.deepEqual(source,before);assert.deepEqual(settings,{enabled:['all-links','menu']});
 assert.equal(preparationSummary(config).automatic.length,4);
 assert.equal(preparationSummary(config,undefined,{enabled:[]}).automatic.length,0);
});

test('shared missing condition contract covers search, menu, keyboard and contact alternatives',()=>{
 assert.deepEqual(interactionMissingConditions('all-links',{paths:['/']}),[]);
 assert.deepEqual(interactionMissingConditions('all-links',{paths:[]}),['paths']);
 const search={mainSelector:'main',sitePath:'/',search:{openSelector:'#open',inputSelector:'input',submitSelector:'button',resultHeadingSelector:'h1',emptyTerm:'none',emptyText:'No results'}};
 assert.deepEqual(interactionMissingConditions('search-empty',search),[]);
 assert.deepEqual(interactionMissingConditions('search-product',search),['search.term','search.resultSelector']);
 assert.deepEqual(interactionMissingConditions('keyboard',{mainSelector:'main',contact:{path:'/contact',keyboardSelectors:['a','b']}}),['contact.keyboardSelectors']);
 assert.deepEqual(interactionMissingConditions('keyboard',{mainSelector:'main',contact:{path:'/contact',keyboardSelectors:['a','b','c']}}),[]);
 assert(interactionMissingConditions('network-failure',{}).includes('contact.responseSelector'));
 assert(!interactionMissingConditions('server-validation',{}).includes('mainSelector'));
 assert(interactionMissingConditions('cart-limit',{commerce:{limitQuantity:1}}).includes('commerce.limitQuantity'));
 assert(!interactionMissingConditions('cart-limit',{commerce:{limitQuantity:2}}).includes('commerce.limitQuantity'));
 assert(interactionMissingConditions('server-validation',{contact:{formId:31,restPath:'/wp-json/contact-form-7/v1/contact-forms/32/feedback'}}).includes('contact.restPath'));
 assert(!interactionMissingConditions('server-validation',{contact:{formId:31,restPath:'/shop/wp-json/contact-form-7/v1/contact-forms/31/feedback'}}).includes('contact.restPath'));
});
test('absent settings derive only safe default operations and paths without invented assertions',()=>{
 const result=generateInteractionChecks(config,profile);
 assert.deepEqual(result.checks.map(c=>c.options.operation),['all-links','firefox','performance','public-discovery']);
 assert.deepEqual(result.checks.map(c=>c.suite),['delivery','compatibility','performance','seo']);
 assert.deepEqual(result.checks[0].options.settings,{enabled:['all-links','firefox','performance','public-discovery'],sitePath:'/shop/',paths:['/shop/','/shop/product?x=1'],representativePaths:['/shop/','/shop/product?x=1']});
 assert.deepEqual(config.checks,[]);
});

test('settings resolve write revocation, representative scope and opt-in shared profiles',async t=>{
 const browser=await chromium.launch();
 const fullConfig={...config,name:'Review',pages:Array.from({length:10},(_,i)=>({id:'p'+i,path:'/p'+i,canonical:'https://example.test/p'+i,indexable:false})),admin:[],journeys:[],visuals:[],manual:[]};
 async function open(c,p){
  const page=await browser.newPage();
  await page.route('http://interaction.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   return route.fulfill(pathname.endsWith('.js')?{contentType:'text/javascript',body:await readFile(new URL('../ui/public/'+pathname.slice(1),import.meta.url),'utf8')}:{contentType:'text/html',body:'<button id="new-site">New</button><button id="edit-site">Edit</button>'});
  });
  await page.goto('http://interaction.test/');
  await page.evaluate(async({c,p})=>{
   const {initSettings}=await import('/settings.js');window.saved=null;
   initSettings({shared:true,currentProject:()=> 'managed',onSaved:async()=>{},api:async(url,options)=>{
    if(options?.method==='POST'){window.saved=JSON.parse(options.body);return {id:'managed'};}
    return url==='/api/logins/current'?{login:null}:{config:c,profile:p,managed:true,version:'v1',credentials:{}};
   }});
  },{c,p});await page.click('#edit-site');return page;
 }
 async function save(page){await page.click('#editor-save');await page.waitForFunction(()=>window.saved||document.querySelector('#editor-error').textContent);assert.equal(await page.locator('#editor-error').textContent(),'');return page.evaluate(()=>window.saved);}
 try{
  await t.test('revoking either write checkbox disables selected write operations and persists false',async()=>{
   const p={...profile,adminPath:'/shop/wp-admin/',interactions:{enabled:['cart-limit']}};
   const page=await open(generateInteractionChecks(fullConfig,p),p);
   assert.match(await page.locator('#settings-preparation [data-preparation-id="interaction-cart-limit"]').textContent(),/数量入力欄/);
   await page.locator('[data-writes]').uncheck();
   assert.equal(await page.locator('#settings-preparation [data-preparation-id="interaction-cart-limit"]').count(),0);
   const saved=await save(page);
   assert.equal(saved.profile.writes,false);assert.equal(saved.config.allowTestWrites,false);
   assert(!saved.config.checks.some(c=>c.options.operation==='cart-limit'));
   assert(!profileJourneys(saved.profile).some(j=>/lifecycle|scheduled/.test(j.id)));
   await page.close();
  });
  await t.test('enabling all-links from public-discovery restores the complete registered inventory',async()=>{
   const page=await open(generateInteractionChecks(fullConfig,{interactions:{enabled:['public-discovery']}}));
   await page.locator('[name=interaction-enabled-all-links]').check();const saved=await save(page);
   assert.equal(saved.config.checks.find(c=>c.options.operation==='all-links').options.settings.paths.length,10);
   await page.close();
  });
  await t.test('shared config-only sites can explicitly register all six built-ins',async()=>{
   const page=await open({...fullConfig,allowTestWrites:false});
   assert.equal(await page.locator('#enable-operation-profile').count(),1);
   await page.locator('#enable-operation-profile').check();
   await page.locator('#operation-profile-section details').evaluate(el=>{el.open=true;});
   const field=k=>page.locator('#operation-profile-section [data-key='+k+']');
   await field('timezone').fill('Asia/Tokyo');await field('language').fill('ja');
   await field('contactFormId').fill('31');await field('testEmail').fill('qa@example.test');
   await field('productPath').fill('/product');await field('expectedTotal').fill('1000');
   await field('writes').check();await field('submit').check();await field('bankOrder').check();
   const saved=await save(page);const validated=validateProfile(saved.profile,'staging');
   assert.equal(profileJourneys(validated).length,6);assert.equal(saved.config.allowTestWrites,true);
   await page.close();
  });
  await t.test('ordinary admin edits supersede stale JSON overrides without losing unrelated entries',async()=>{
   const entry={id:'mail',title:'Mail',path:'options.php',selector:'#email',read:'value',expected:'old@example.test'};
   const p={...profile,adminPath:'/shop/wp-admin/',interactions:{enabled:[],admin:[entry]}};
   const page=await open(generateInteractionChecks(fullConfig,p),p);
   await page.locator('#admin-editors [data-key=expected]').fill('edited@example.test');
   const saved=await save(page);
   assert.equal(saved.config.admin[0].expected,'edited@example.test');
   assert.deepEqual(saved.profile.interactions.admin,[]);
   assert.equal(generateInteractionChecks(saved.config,saved.profile).admin[0].expected,'edited@example.test');
   await page.close();
  });
 }finally{await browser.close();}
});
test('all selected operations receive complete independent settings, including inventory and contact names',()=>{
 const enabled=['all-links','search-product','search-empty','search-special','menu','menu-navigation','contact-validation','server-validation','network-failure','keyboard','firefox','performance','public-discovery','cart-limit','customer-empty'];
 const settings={enabled,search:{term:'商品',emptyTerm:'missing',specialTerm:'<>&'},contact:{nameField:'your-name',emailField:'your-email',messageField:'message',consentField:'accept',keyboardSelectors:['input','button']},inventory:{postTypes:['posts','pages','products'],supplementalPaths:['/shop/catalog'],componentRedirects:[{postType:'components',path:'/shop/component'}]}};
 const result=generateInteractionChecks(config,{...profile,interactions:settings});
 assert.equal(result.checks.length,15);
 for(const c of result.checks){assert.equal(c.id,'interaction-'+c.options.operation);assert.equal(c.kind,'site-interaction');assert.deepEqual(c.options.settings.inventory,settings.inventory);assert.deepEqual(c.options.settings.contact,settings.contact);}
 assert.equal(result.checks.find(c=>c.options.operation==='keyboard').suite,'accessibility');
 assert.equal(result.checks.find(c=>c.options.operation==='cart-limit').suite,'commerce');
 assert.equal(result.checks.find(c=>c.options.operation==='customer-empty').suite,'commerce');
 result.checks[0].options.settings.inventory.postTypes.push('other');
 assert.equal(settings.inventory.postTypes.length,3);assert.equal(result.checks[1].options.settings.inventory.postTypes.length,3);
});
test('refresh removes disabled generated checks, is idempotent and preserves custom checks including ID collisions',()=>{
 const custom={id:'interaction-menu',kind:'custom',options:{nested:{value:1}}};
 const first=generateInteractionChecks({...config,checks:[custom,{id:'custom-interaction',kind:'site-interaction',options:{operation:'keyboard'}}]},profile);
 const second=generateInteractionChecks(first,{...profile,interactions:{enabled:['menu']}});
 assert.equal(second.checks.length,2);assert.deepEqual(second.checks[0],custom);
 assert.deepEqual(generateInteractionChecks(second,{...profile,interactions:{enabled:['menu']}}),second);
 second.checks[0].options.nested.value=2;assert.equal(custom.options.nested.value,1);
 assert.deepEqual(generateInteractionChecks(config,{...profile,interactions:{enabled:[]}}).checks,[]);
});
test('settings reject malformed nested values and offsite paths while accepting optional groups',()=>{
 assert.doesNotThrow(()=>validateInteractionSettings(undefined));
 assert.doesNotThrow(()=>validateInteractionSettings({enabled:[],menu:{openedValue:'',closedValue:'false'},commerce:{limitQuantity:2},inventory:{postTypes:['product_item'],supplementalPaths:[],componentRedirects:[]}}));
 for(const value of [null,[],{enabled:['unknown']},{enabled:['menu','menu']},{search:[]},{search:{typo:'x'}},{contact:{formId:0}},{contact:{keyboardSelectors:'input'}},{commerce:{limitQuantity:1.5}},{sitePath:'//evil.test'},{paths:['/\\evil.test']},{inventory:{postTypes:[2]}},{inventory:{supplementalPaths:['https://evil.test']}},{inventory:{componentRedirects:[{postType:'pages',path:'//evil.test'}]}}])assert.throws(()=>validateInteractionSettings(value));
});
test('write-sensitive interactions require explicit profile and config permission in staging/local',()=>{
 for(const operation of ['server-validation','cart-limit','customer-empty']){
  const p={...profile,interactions:{enabled:[operation]}};
  assert.throws(()=>validateProfile({...p,writes:false},'staging'),/操作許可/);
  assert.throws(()=>generateInteractionChecks({...config,allowTestWrites:false},p),/操作許可/);
  assert.throws(()=>generateInteractionChecks({...config,environment:'production'},p),/操作許可/);
  assert.doesNotThrow(()=>generateInteractionChecks(config,p));
 }
 assert.doesNotThrow(()=>validateProfile({...profile,writes:false,interactions:{enabled:['contact-validation','network-failure']}},'production'));
});
test('registration includes interactions and helper accepts subpath/settings without weakening authentication',()=>{
 const p={...profile,interactions:{enabled:['all-links'],inventory:{postTypes:['products']}}};
 const c=registrationConfig({name:'Fixture',baseURL:config.baseURL,environment:'staging',profile:p,discovery:{pages:config.pages,warnings:[]}});
 assert.equal(c.checks.filter(c=>c.kind==='site-interaction').length,1);
 const env={WPQA_UI_PROFILE:JSON.stringify(p),WPQA_UI_ADMIN_STATE:JSON.stringify({cookies:[],origins:[]})};
 assert.deepEqual(readSettings(config,env).profile.interactions,p.interactions);
 assert.equal(readSettings(config,env).profile.sitePath,'/shop/');
 assert.throws(()=>readSettings(config,{...env,WPQA_UI_ADMIN_STATE:JSON.stringify({cookies:[],origins:[{origin:'https://evil.test',localStorage:[]}]})}),/unrelated/);
 assert.throws(()=>readSettings(config,{...env,WPQA_UI_PROFILE:JSON.stringify({...p,interactions:{enabled:['bad']}})}));
});

test('additional admin expectations use the configured admin root and preserve custom IDs',()=>{
 const custom={id:'keep',source:'rest',path:'/api',expected:'custom'};
 const p={...profile,adminPath:'/shop/wp-admin/',interactions:{enabled:[],admin:[
  {id:'mail',title:'管理メール',path:'options-general.php',selector:'#admin_email',read:'value',expected:'qa@example.test'},
  {id:'flag',title:'フラグ',path:'/wp-admin/options-reading.php',selector:'#blog_public',read:'checked',expected:false},
  {id:'heading',title:'見出し',path:'/shop/wp-admin/edit.php',selector:'h1',read:'text',expected:'投稿'}
 ]}};
 const result=generateInteractionChecks({...config,admin:[custom]},p);
 assert.equal(result.admin.length,4);assert.deepEqual(result.admin[0],custom);
 assert.deepEqual(result.admin[1],{id:'mail',title:'管理メール',path:'/shop/wp-admin/options-general.php',selector:'#admin_email',read:'value',expected:'qa@example.test',source:'browser',authenticatedSelector:'#wpadminbar',storageStateEnv:'WPQA_UI_ADMIN_STATE'});
 assert.equal(result.admin[2].path,'/shop/wp-admin/options-reading.php');assert.equal(result.admin[2].expected,false);
 assert.equal(result.admin[3].expected,'投稿');
 assert.throws(()=>validateInteractionSettings({admin:[{...p.interactions.admin[0],read:'count',expected:3}]}));
 assert.deepEqual(generateInteractionChecks(result,p),result);
 for(const bad of [{...p.interactions.admin[0],path:'https://evil.test'},{...p.interactions.admin[0],read:'html'},{...p.interactions.admin[0],expected:{}},{...p.interactions.admin[0],path:'../secret'}])assert.throws(()=>validateInteractionSettings({admin:[bad]}));
});

test('explicit admin IDs replace old expectations without losing unrelated checks or sensitivity',()=>{
 const unrelated={id:'other',source:'rest',path:'/api',field:'name',expected:'keep'};
 const entry={id:'mail',title:'Mail',path:'options.php',selector:'#email',read:'value',expected:'new@example.test'};
 const source={...config,admin:[{id:'mail',source:'rest',path:'/old',field:'mail',headersEnv:'OLD',expected:'old@example.test',sensitive:true,required:false},unrelated]};
 const result=generateInteractionChecks(source,{...profile,interactions:{enabled:[],admin:[entry]}});
 assert.equal(result.admin[0].expected,'new@example.test');assert.equal(result.admin[0].source,'browser');
 assert.equal(result.admin[0].sensitive,true);assert.equal(result.admin[0].required,false);
 assert.equal(Object.hasOwn(result.admin[0],'field'),false);assert.equal(Object.hasOwn(result.admin[0],'headersEnv'),false);
 assert.deepEqual(result.admin[1],unrelated);assert.equal(source.admin[0].expected,'old@example.test');
 const next=generateInteractionChecks(result,{...profile,interactions:{enabled:[],admin:[{...entry,expected:'latest@example.test'}]}});
 assert.equal(next.admin[0].expected,'latest@example.test');
});

test('subdirectory CF7 and separate cart update/next selectors survive generation',()=>{
 const interactions={enabled:[],contact:{formId:31,restPath:'/shop/wp-json/contact-form-7/v1/contact-forms/31/feedback'},commerce:{updateSelector:'button[name=update]',nextSelector:'button[name=next]'}};
 assert.deepEqual(validateInteractionSettings(interactions),interactions);
 const result=generateInteractionChecks(config,{...profile,interactions:{...interactions,enabled:['all-links']}});
 assert.equal(result.checks[0].options.settings.contact.restPath,interactions.contact.restPath);
 assert.deepEqual(result.checks[0].options.settings.commerce,interactions.commerce);
});

test('large inventories retain full link coverage but bound browser checks to representative paths',()=>{
 const pages=Array.from({length:200},(_,i)=>({path:'/page-'+i}));
 const generated=generateInteractionChecks({...config,pages},profile);
 assert.equal(generated.checks.find(c=>c.options.operation==='all-links').options.settings.paths.length,200);
 for(const op of ['firefox','performance','public-discovery']){
  const check=generated.checks.find(c=>c.options.operation===op);
  assert.deepEqual(check.options.settings.paths,['/page-0','/page-1','/page-2']);assert.equal(check.timeoutMs,300000);
 }
 assert.equal(generated.checks[0].timeoutMs,900000);
 const explicit=generateInteractionChecks({...config,pages},{...profile,interactions:{representativePaths:['/selected']}});
 assert.deepEqual(explicit.checks.find(c=>c.options.operation==='firefox').options.settings.paths,['/selected']);
 assert.throws(()=>validateInteractionSettings({representativePaths:['https://other.test']}));
});

test('browser registration restores interaction drafts and settings save works without a WordPress profile',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.route('http://interaction.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../ui/public/'+pathname.slice(1),import.meta.url),'utf8')});
   return route.fulfill({contentType:'text/html',body:'<button id="new-site">New</button><button id="edit-site">Edit</button>'});
  });
  const setup=async()=>page.evaluate(async()=>{
   const {initRegistration}=await import('/registration.js');
   document.querySelector('#new-site').onclick=()=>{};
   let login=null;window.registrationSaved=null;
   initRegistration({api:async(url,options)=>{
    if(url==='/api/logins/current')return {login};
    if(url==='/api/logins'){login={id:'fixture-login',phase:'verified'};return login;}
    if(url==='/api/registration'){window.registrationSaved=JSON.parse(options.body);return {id:'registered'};}
    return {};
   },onSaved:async()=>{}});
  });
  await page.goto('http://interaction.test/');await setup();await page.click('#new-site');
  assert.match(await page.locator('#registration-preparation').textContent(),/すべての観点が自動実行されるわけではありません/);
  assert.equal(await page.locator('#registration-preparation [data-preparation=automatic] [data-preparation-id^="interaction-"]').count(),4);
  await page.locator('[name=interaction-enabled-search-product]').check();
  assert.match(await page.locator('#registration-preparation [data-preparation-id="interaction-search-product"]').textContent(),/商品を検索する語句/);
  await page.locator('[name="interaction-mainSelector"]').fill('main');
  await page.locator('details').filter({has:page.locator('[name="interaction-search.term"]')}).locator('summary').click();
  for(const [key,value] of Object.entries({openSelector:'#open',inputSelector:'#search',submitSelector:'#submit',resultHeadingSelector:'h1',term:'known',resultSelector:'.result'}))await page.locator(`[name="interaction-search.${key}"]`).fill(value);
  assert.equal(await page.locator('#registration-preparation [data-preparation=automatic] [data-preparation-id="interaction-search-product"]').count(),1);
  assert.equal(await page.locator('#registration-preparation [data-preparation=additional] [data-preparation-id="interaction-search-product"]').count(),0);
  await page.locator('[name=interaction-enabled-search-product]').uncheck();
  assert.equal(await page.locator('#registration-preparation [data-preparation-id="interaction-search-product"]').count(),0);
  await page.locator('[name=submitContact]').check();
  assert.match(await page.locator('#registration-preparation [data-preparation-id="profile-contact-submit"]').textContent(),/CF7フォームID.*テスト用メールアドレス.*操作許可/);
  await page.locator('[name=submitContact]').uncheck();
  assert.equal(await page.locator('[name=writes]').isChecked(),false);
  assert.equal(await page.locator('[name=submitContact]').isChecked(),false);
  await page.locator('[name="interaction-mainSelector"]').fill('main');
  await page.locator('details').filter({has:page.locator('[name="interaction-inventory.postTypes"]')}).locator('summary').click();
  await page.locator('[name="interaction-inventory.postTypes"]').fill('posts\nproducts');
  await page.locator('details').filter({has:page.locator('[name="interaction-admin"]')}).locator('summary').click();
  await page.locator('[name="interaction-admin"]').fill('[{"id":"mail","title":"Mail","path":"options.php","selector":"#email","read":"value","expected":"qa@example.test"}]');
  await page.reload();await setup();
  assert.equal(await page.locator('[name="interaction-mainSelector"]').inputValue(),'main');
  assert.equal(await page.locator('[name="interaction-inventory.postTypes"]').inputValue(),'posts\nproducts');
  assert.match(await page.locator('[name="interaction-admin"]').inputValue(),/qa@example.test/);
  await page.locator('[name=name]').fill('CF7 schema only');await page.locator('[name=baseURL]').fill('https://example.test');
  await page.locator('[name=contactFormId]').fill('31');await page.locator('[name=contactNameField]').fill('custom-name');
  await page.click('#registration-login');await page.click('#registration-save');
  await page.waitForFunction(()=>window.registrationSaved||document.querySelector('#registration-error').textContent);
  assert.equal(await page.locator('#registration-error').textContent(),'');
  const registration=await page.evaluate(()=>window.registrationSaved);
  assert.equal(registration.profile.contactFormId,31);assert.equal(registration.profile.contactNameField,'custom-name');
  for(const key of ['contactPath','contactEmailField','contactMessageField','contactConsentField']){assert.equal(registration.profile[key],undefined);assert.equal(Object.hasOwn(registration.profile,key),false);}
  assert.notEqual(registration.profile.submit,true);assert.equal(registration.profile.writes,false);
  // Start the independent existing-site editor with a config-only managed site.
  await page.goto('http://interaction.test/settings');
  await page.evaluate(async c=>{
   const {initSettings}=await import('/settings.js');window.saved=null;
   initSettings({currentProject:()=> 'managed',onSaved:async()=>{},api:async(url,options)=>{
    if(options?.method==='POST'){window.saved=JSON.parse(options.body);return {id:'managed'};}
    if(url==='/api/logins/current')return {login:null};
    return {config:c,managed:true,version:'v1',credentials:{}};
   }});
  },{...config,name:'Config only',admin:[],journeys:[],visuals:[],manual:[],checks:[{id:'interaction-all-links',title:'Links',kind:'site-interaction',suite:'delivery',options:{operation:'all-links',settings:{enabled:['all-links'],sitePath:'/shop/',paths:['/shop/'],mainSelector:'#original'}}}]});
  await page.click('#edit-site');
  assert.equal(await page.locator('#interaction-profile-section').isVisible(),true);
  assert.equal(await page.locator('[name="interaction-mainSelector"]').inputValue(),'#original');
  await page.locator('[name="interaction-mainSelector"]').fill('#updated');
  assert.equal(await page.locator('#refresh-automation').isChecked(),true);
  assert.deepEqual(await page.locator('#site-editor :invalid').evaluateAll(es=>es.map(e=>({name:e.name,id:e.id,key:e.dataset.key,message:e.validationMessage,html:e.outerHTML}))),[]);await page.click('#editor-save');await page.waitForFunction(()=>window.saved||document.querySelector('#editor-error').textContent);assert.equal(await page.locator('#editor-error').textContent(),'');
  const saved=await page.evaluate(()=>window.saved);
  assert.equal(Object.hasOwn(saved,'profile'),false);
  assert.equal(saved.config.checks.find(c=>c.kind==='site-interaction').options.settings.mainSelector,'#updated');
  // A new advanced registration without a profile still gets the four defaults.
  await page.click('#new-site');await page.locator('#site-fields [data-key=name]').fill('New');await page.locator('#site-fields [data-key=baseURL]').fill('https://example.test');
  await page.evaluate(()=>{window.saved=null;});assert.deepEqual(await page.locator('#site-editor :invalid').evaluateAll(es=>es.map(e=>({name:e.name,id:e.id,key:e.dataset.key,message:e.validationMessage,html:e.outerHTML}))),[]);await page.click('#editor-save');await page.waitForFunction(()=>window.saved||document.querySelector('#editor-error').textContent);assert.equal(await page.locator('#editor-error').textContent(),'');
  const created=await page.evaluate(()=>window.saved);
  assert.equal(Object.hasOwn(created,'profile'),false);
  assert.deepEqual(created.config.checks.filter(c=>c.kind==='site-interaction').map(c=>c.options.operation),['all-links','firefox','performance','public-discovery']);
 }finally{await browser.close();}
});

