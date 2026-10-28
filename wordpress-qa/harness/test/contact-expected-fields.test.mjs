import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfile} from '../ui/registration.mjs';
import {readSettings} from '../builtin/wordpress-profile/helpers.mjs';

const profile={timezone:'Asia/Tokyo',language:'ja',indexable:false,writes:false,contactMessageField:'your-message'};
const read=p=>readSettings({baseURL:'https://fixture.test'},{WPQA_UI_PROFILE:JSON.stringify(p),WPQA_UI_ADMIN_STATE:JSON.stringify({cookies:[],origins:[]})}).profile;
test('both validators preserve declared optional fields without inferring required=true',()=>{
  const fields=[{name:'your-name',type:'text',required:true},{name:'your-message',type:'textarea',required:false},{name:'consent',type:'checkbox',required:false}];
  const p=validateProfile({...profile,contactExpectedFields:fields},'staging');
  assert.deepEqual(p.contactExpectedFields,fields);assert.notEqual(p.contactExpectedFields,fields);
  assert.deepEqual(read(p).contactExpectedFields,fields);
  fields[1].required=true;assert.equal(p.contactExpectedFields[1].required,false);
});
test('all specified types and 1..100 unique entries are accepted',()=>{
  const fields=['text','email','tel','url','number','date','textarea','select','checkbox','radio','file'].map((type,i)=>({name:'field-'+i,type,required:i%2===0}));
  for(const list of [[fields[0]],fields,Array.from({length:100},(_,i)=>({name:'field-'+i,type:'text',required:true}))]){
    assert.deepEqual(validateProfile({...profile,contactExpectedFields:list},'staging').contactExpectedFields,list);
    assert.deepEqual(read({...profile,contactExpectedFields:list}).contactExpectedFields,list);
  }
});
test('empty arrays and repeated names cannot produce vacuous or ambiguous expectations',()=>{
  const field={name:'your-message',type:'textarea',required:false};
  for(const fields of [[],[field,{...field}],[field,{...field,type:'text',required:true}]]){
    for(const fn of [p=>validateProfile(p,'staging'),read])assert.throws(()=>fn({...profile,contactExpectedFields:fields}),/contactExpectedFields/);
  }
});
test('malformed arrays and entries are rejected consistently without echoing data',()=>{
  const valid={name:'field',type:'text',required:true};
  const cases=[null,{},'SECRET_VALUE',Array(101).fill(valid),[null],[[]],[{}],[{...valid,required:'true'}],[{name:'field',type:'text'}],[{...valid,name:'bad name'}],[{...valid,name:'a'.repeat(101)}],[{...valid,name:42}],[{...valid,type:'password'}],[{...valid,type:'hidden'}],[{...valid,type:'acceptance'}],[{...valid,value:'SECRET_VALUE'}]];
  for(const value of cases)for(const fn of [p=>validateProfile(p,'staging'),read])assert.throws(()=>fn({...profile,contactExpectedFields:value}),e=>e.message.includes('contactExpectedFields')&&!e.message.includes('SECRET_VALUE'));
  assert.throws(()=>validateProfile({...profile,contactExpectedFields:new Array(1)},'staging'),/contactExpectedFields/);
});
test('legacy manual profiles retain absence of expected-fields override',()=>{
  for(const p of [validateProfile(profile,'staging'),read(profile)]){
    assert.equal(Object.hasOwn(p,'contactExpectedFields'),false);
    assert.equal(p.contactMessageField,'your-message');
  }
});
