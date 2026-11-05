import test from 'node:test';import assert from 'node:assert/strict';import {scanChildCode,inspectChildTheme} from '../lib/child-theme-code.mjs';
test('direct risky input patterns locate lines without storing source or secret values',()=>{const source="<?php\n// echo $_GET['ignored'];\necho $_GET['q'];\n$secret='NEVER_SAVE_THIS';\nsystem($_POST['cmd']);\necho esc_html($_GET['safe']);";const r=scanChildCode('functions.php',source);assert.deepEqual(r.findings.map(x=>x.line),[3,5]);assert(!JSON.stringify(r).includes('NEVER_SAVE_THIS'));assert(!JSON.stringify(r).includes("$_GET"));});
test('editor collection accepts only listed local files and refuses mismatched editor response',async()=>{const page=(file,code)=>`<form id="template"><input name="theme" value="child"><input name="file" value="${file}"><textarea id="newcontent">${code}</textarea></form><a href="theme-editor.php?theme=child&amp;file=functions.php">PHP</a><a href="https://evil.test/theme-editor.php?theme=child&amp;file=evil.php">bad</a><a href="theme-editor.php?theme=child&amp;file=../secret.php">bad</a>`;const calls=[];const r=await inspectChildTheme({slug:'child'},async p=>{calls.push(p);return page('functions.php','echo $_GET[0];');});assert.equal(calls.length,1);assert.equal(r.files.length,1);assert.equal(r.findings.length,1);assert(r.incomplete.length>0);const denied=await inspectChildTheme({slug:'child'},async()=>'<form id="loginform"></form>');assert.equal(denied.files.length,0);assert(denied.incomplete.length);});
test('limits and mismatched responses stay explicit and exceptions never expose contents',async()=>{
 const html='<form id="template"><input name="theme" value="child"><input name="file" value="style.css"><textarea id="newcontent">body {}</textarea></form>'+Array.from({length:35},(_,i)=>'<a href="theme-editor.php?theme=child&amp;file=f'+i+'.php">file</a>').join('');
 let calls=0;const r=await inspectChildTheme({slug:'child'},async()=>{calls++;if(calls===1)return html;throw Error('SECRET');});
 assert.equal(calls,30);assert.equal(r.files.length,1);assert(r.incomplete.length>=30);assert(!JSON.stringify(r).includes('SECRET'));
});
test('escaped output and block comments do not produce direct-input findings',()=>{
 assert.equal(scanChildCode('x.php','<?php /* echo $_GET[0];\nsystem($_POST[0]); */\necho esc_attr($_GET[0]);').findings.length,0);
 const r=scanChildCode('x.php','<?php\nrequire $_GET[0];\n$wpdb->query($_POST[0]);');
 assert.deepEqual(r.findings.map(f=>f.rule),['include','sql']);
});
test('subdirectory WordPress absolute editor links are collected',async()=>{
 const page=f=>'<form id="template"><input name="theme" value="child"><input name="file" value="'+f+'"><textarea id="newcontent">echo $_GET[0];</textarea></form><a href="/sub/wp-admin/theme-editor.php?theme=child&amp;file=functions.php">PHP</a>';
 const r=await inspectChildTheme({slug:'child'},async p=>page(p.includes('&file=')?'functions.php':'style.css'),'https://site.test/sub/wp-admin/theme-editor.php');
 assert.equal(r.files.length,2);assert.equal(r.findings.length,1);
});
