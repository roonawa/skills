import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile, copyFile, access, readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { request } from '@playwright/test';
import { run } from '../../lib/checks/wordpress.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const runtime=resolve(root,'.selftest/real-wordpress');
// Keep Playground's release cache inside the ignored test directory.
process.env.USERPROFILE=runtime;
const require=createRequire(resolve(runtime,'package.json'));
const {runCLI}=await import(pathToFileURL(require.resolve('@wp-playground/cli')).href);
const wpVersion=process.env.WPQA_REAL_WP||'6.8.3';
if(!/^\d+\.\d+(?:\.\d+)?$/.test(wpVersion))throw new Error('WPQA_REAL_WP must be a numeric release');
const releaseURL=`https://wordpress.org/wordpress-${wpVersion}.zip`;
const downloaded=resolve(runtime,`wordpress-${wpVersion}.zip`);
try{
  await access(downloaded);
  const cache=resolve(runtime,'.wordpress-playground');await mkdir(cache,{recursive:true});
  await copyFile(downloaded,resolve(cache,`custom-${createHash('sha1').update(releaseURL).digest('hex').slice(0,8)}.zip`));
}catch(error){if(error.code!=='ENOENT')throw error;}
const port=Number(process.env.WPQA_REAL_PORT||9417), baseURL=`http://127.0.0.1:${port}`;
const password=randomBytes(24).toString('hex');
const variant=process.env.WPQA_REAL_VARIANT||'core';
if(!['core','plugins'].includes(variant))throw new Error('WPQA_REAL_VARIANT must be core or plugins');
const selectedCases=(process.env.WPQA_REAL_CASES||'wp-lifecycle,wp-authz,wp-cache,wp-scheduled').split(',');
if(selectedCases.some(k=>!['wp-lifecycle','wp-authz','wp-cache','wp-scheduled'].includes(k)))throw new Error('Invalid WPQA_REAL_CASES');
const diagnostic=Boolean(process.env.WPQA_REAL_CASES);
const forceHTMLAccept=process.env.WPQA_REAL_ACCEPT_HTML==='1';
const steps=variant==='plugins'?[
  {step:'installPlugin',pluginData:{resource:'url',url:'https://downloads.wordpress.org/plugin/contact-form-7.6.1.3.zip'},options:{activate:true}},
  {step:'installPlugin',pluginData:{resource:'url',url:'https://downloads.wordpress.org/plugin/wp-super-cache.3.1.4.zip'},options:{activate:true}},
  {step:'runPHP',code:"<?php require '/wordpress/wp-load.php'; switch_theme('twentytwentyfour'); wp_cache_enable(); wp_super_cache_enable(); wp_cache_setting('wpsc_served_header', true);"}
]:[];
const evidence={at:new Date().toISOString(),variant,diagnostic,forceHTMLAccept,node:process.version,playground:require('@wp-playground/cli/package.json').version,runtime:'WordPress Playground; PHP WASM; SQLite; loopback only',cases:[]};
try{evidence.releaseSHA256=createHash('sha256').update(await readFile(downloaded)).digest('hex');}catch{}
let server,login;
try{
  server=await runCLI({command:'server',port,wp:releaseURL,php:'8.3',login:false,
    'site-url':baseURL,blueprint:{constants:{WP_ENVIRONMENT_TYPE:'local',DISABLE_WP_CRON:true,...(variant==='plugins'?{WP_CACHE:true}:{})},steps}});
  // Playground CLI binds all interfaces by default; rebind before creating credentials.
  await new Promise((res,rej)=>server.server.close(e=>e?rej(e):res()));
  await new Promise((res,rej)=>server.server.listen(port,'127.0.0.1',res).once('error',rej));
  const php=async code=>server.playground.run({code:`<?php require '/wordpress/wp-load.php'; ${code}`});
  if(diagnostic)await php("wp_mkdir_p(WP_CONTENT_DIR.'/mu-plugins');");
  if(diagnostic)await server.playground.writeFile('/wordpress/wp-content/mu-plugins/wpqa-cache-diagnostic.php',`<?php add_action('send_headers', function(){header('X-WPQA-Cache-Diagnostic: '.base64_encode(json_encode(['sapi'=>PHP_SAPI,'self'=>$_SERVER['PHP_SELF']??null,'script'=>$_SERVER['SCRIPT_FILENAME']??null,'accept'=>$_SERVER['HTTP_ACCEPT']??null,'backend'=>function_exists('wpsc_is_backend')?wpsc_is_backend():null,'dontCache'=>defined('DONOTCACHEPAGE')?DONOTCACHEPAGE:null,'enabled'=>$GLOBALS['cache_enabled']??null])));});`);
  const cacheDiagnostic=async()=>JSON.parse((await php(`
    $keys=['cache_enabled','super_cache_enabled','wpsc_served_header','wp_cache_phase1_loaded','cache_path','wp_cache_mod_rewrite','wp_cache_not_logged_in'];
    $values=[];foreach($keys as $key)$values[$key]=$GLOBALS[$key]??null;
    $files=[];if(is_dir(WP_CONTENT_DIR.'/cache'))foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator(WP_CONTENT_DIR.'/cache',FilesystemIterator::SKIP_DOTS)) as $f)if($f->isFile())$files[]=['name'=>str_replace(WP_CONTENT_DIR,'',$f->getPathname()),'size'=>$f->getSize()];
    echo json_encode(['values'=>$values,'dropin'=>file_exists(WP_CONTENT_DIR.'/advanced-cache.php'),'config'=>file_exists(WP_CONTENT_DIR.'/wp-cache-config.php'),'included'=>array_values(array_filter(get_included_files(),fn($f)=>str_contains($f,'cache'))),'files'=>$files]);
  `)).text);
  const bootstrap=await php(`
    wp_set_password('${password}',1);
    $subscriber=wp_create_user('qa_subscriber','${password}','qa@example.test');
    (new WP_User($subscriber))->set_role('subscriber');
    $admin=WP_Application_Passwords::create_new_application_password(1,['name'=>'qa-local']);
    $sub=WP_Application_Passwords::create_new_application_password($subscriber,['name'=>'qa-local']);
    // This isolated cron test excludes background update checks that contact remote services.
    foreach (_get_cron_array() as $time=>$hooks) foreach ($hooks as $hook=>$events) foreach ($events as $event) wp_unschedule_event($time,$hook,$event['args']);
    global $wp_version; require_once ABSPATH.'wp-admin/includes/plugin.php';
    echo json_encode(['wp'=>$wp_version,'php'=>PHP_VERSION,'theme'=>wp_get_theme()->get('Name'),'themeVersion'=>wp_get_theme()->get('Version'),'plugins'=>get_plugins(),'activePlugins'=>get_option('active_plugins'),'pageCacheEnabled'=>defined('WP_CACHE') && WP_CACHE,'admin'=>$admin[0],'subscriber'=>$sub[0],'subscriberId'=>$subscriber]);
  `);
  const data=JSON.parse(bootstrap.text);
  const {admin,subscriber,subscriberId,...versions}=data;evidence.versions=versions;
  process.env.WPQA_UI_ADMIN_HEADERS=JSON.stringify({Authorization:`Basic ${Buffer.from(`admin:${admin}`).toString('base64')}`});
  process.env.WPQA_ROLE_SUBSCRIBER_HEADERS=JSON.stringify({Authorization:`Basic ${Buffer.from(`qa_subscriber:${subscriber}`).toString('base64')}`});
  login=await request.newContext();
  await login.get(`${baseURL}/wp-login.php`);
  const logged=await login.post(`${baseURL}/wp-login.php`,{form:{log:'admin',pwd:password,'wp-submit':'Log In',redirect_to:`${baseURL}/wp-admin/`,testcookie:'1'}});
  if(logged.status()!==200)throw new Error(`Login failed: ${logged.status()}`);
  process.env.WPQA_UI_ADMIN_STATE=JSON.stringify(await login.storageState());
  if(variant==='plugins'){
    const form=await php(`$forms=get_posts(['post_type'=>'wpcf7_contact_form','numberposts'=>1]); echo json_encode(['id'=>$forms ? $forms[0]->ID : null]);`);
    const {id}=JSON.parse(form.text);
    if(!id)throw new Error('CF7 did not provide its default contact form');
    const anon=await request.newContext();
    try{
      const r=await anon.post(`${baseURL}/wp-json/contact-form-7/v1/contact-forms/${id}/feedback`,{multipart:{_wpcf7_unit_tag:`wpcf7-f${id}-o1`}});
      const feedback=await r.json();
      evidence.cf7={status:r.status(),result:feedback.status,invalidFieldCount:feedback.invalid_fields?.length||0};
      if(r.status()!==200||feedback.status!=='validation_failed'||!evidence.cf7.invalidFieldCount)throw new Error('Real CF7 required-field validation failed');
    }finally{await anon.dispose();}
  }
  if(diagnostic)evidence.cacheBefore=await cacheDiagnostic();
  for(const kind of selectedCases){
    let cron;
    // Invoke the real WordPress cron endpoint, as a host scheduler would. No status mutation.
    let cronBusy=false;
    if(kind==='wp-scheduled')cron=setInterval(async()=>{if(cronBusy)return;cronBusy=true;try{await fetch(`${baseURL}/wp-cron.php`,{signal:AbortSignal.timeout(30000)});}catch{}finally{cronBusy=false;}},1000);
    const options={maxWaitMs:100000,pollIntervalMs:1000,...(kind==='wp-scheduled'?{scheduleDelayMs:65000}:{}),
      ...(kind==='wp-authz'?{role:'subscriber',expectedUserId:subscriberId,expectedRoles:['subscriber'],readStatus:403,readCode:'rest_forbidden',updateStatus:403,updateCode:'rest_cannot_edit'}:{})};
    try{
      let cacheHits=0;
      const requestFactory={async newContext(options){
        const context=await request.newContext(options);
        return {dispose:()=>context.dispose(),async fetch(url,options){
          if(forceHTMLAccept&&options.method==='GET'&&!url.includes('/wp-json/'))options={...options,headers:{...options.headers,Accept:'text/html'}};
          const response=await context.fetch(url,options);
          if(response.status()>=300&&response.status()<400)console.error(`Redirect: ${new URL(url).pathname}${new URL(url).search} -> ${response.headers().location}`);
          if(response.headers()['x-wp-super-cache']?.startsWith('Served'))cacheHits++;
          if(diagnostic&&options.method==='GET'&&!url.includes('/wp-json/')){
            const body=await response.text();
            (evidence.responses??=[]).push({path:new URL(url).pathname,status:response.status(),cacheHeader:response.headers()['x-wp-super-cache']||null,diagnostic:response.headers()['x-wpqa-cache-diagnostic']?JSON.parse(Buffer.from(response.headers()['x-wpqa-cache-diagnostic'],'base64').toString()):null,cacheControl:response.headers()['cache-control']||null,comments:body.match(/<!--[^]*?-->/g)?.filter(x=>/cache|generated/i.test(x)).map(x=>x.slice(0,400))||[]});
            evidence.cacheDuring=await cacheDiagnostic();
          }
          return response;
        }};
      }};
      const result=await run({check:{kind,options},config:{baseURL,environment:'local',allowTestWrites:true,timeoutMs:30000},requestFactory});
      evidence.cases.push({kind,status:'pass',...result,cacheHits});console.log(`PASS ${kind}`);
    }catch(error){evidence.cases.push({kind,status:'fail',message:error.message});console.error(`FAIL ${kind}: ${error.message}`);}
    finally{clearInterval(cron);}
  }
  const leftovers=await php(`echo json_encode(get_posts(['post_type'=>'post','post_status'=>'any','s'=>'wpqa-','numberposts'=>-1,'fields'=>'ids']));`);
  evidence.leftoverPostIds=JSON.parse(leftovers.text);
  if(evidence.leftoverPostIds.length)throw new Error('Owned test posts remain after cleanup');
  if(variant==='plugins'&&selectedCases.includes('wp-cache')&&!evidence.cases.some(c=>c.kind==='wp-cache'&&c.cacheHits>0))throw new Error('Plugin variant did not demonstrate a real WP Super Cache hit');
}catch(error){evidence.error=error.message;console.error(error);}
finally{
  await login?.dispose();
  await server?.[Symbol.asyncDispose]();
  await mkdir(runtime,{recursive:true});
  await writeFile(resolve(runtime,`evidence-${variant}${diagnostic?'-diagnostic':''}.json`),JSON.stringify(evidence,null,2));
  for(const name of ['WPQA_UI_ADMIN_HEADERS','WPQA_ROLE_SUBSCRIBER_HEADERS','WPQA_UI_ADMIN_STATE'])delete process.env[name];
}
if(evidence.error||evidence.cases.length!==selectedCases.length||evidence.cases.some(c=>c.status!=='pass'))process.exitCode=1;
