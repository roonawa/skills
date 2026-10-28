import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schemaExpectations,inventoryPolicy} from '../builtin/wordpress-profile/expectations.mjs';
import {contactFields} from '../builtin/wordpress-profile/helpers.mjs';
test('auto-discovered required fields compare admin declarations without inventing optional requirements',()=>{
 const profile={contactMessageField:'message',contactExpectedFields:[{name:'email',type:'email',required:true}]};
 assert.equal(schemaExpectations(profile,contactFields('[email* email][textarea message]')).missing.length,0);
 assert.equal(schemaExpectations(profile,contactFields('[email email][textarea message]')).missing.length,1);
});
test('CF7 required and type expectations fail optional or wrong type fields',()=>{
 const p={contactNameField:'your-name',contactEmailField:'your-email'};
 assert.equal(schemaExpectations(p,contactFields('[text* your-name][email* your-email]')).missing.length,0);
 assert.deepEqual(schemaExpectations(p,contactFields('[text your-name][text* your-email]')).missing.map(x=>x.name),['your-name','your-email']);
});
test('CMS inventory supports configured custom types and component redirects',()=>{
 assert.deepEqual(inventoryPolicy({}).postTypes,['post','page']);
 assert.deepEqual(inventoryPolicy({interactions:{inventory:{postTypes:['post','snsembed'],componentRedirects:[{postType:'blog_parts',path:'/'}]}}}).postTypes,['post','snsembed']);
 assert.throws(()=>inventoryPolicy({interactions:{inventory:{postTypes:['../']}}}));
});

test('legacy CF7 profiles without field expectations cannot pass by observation alone',()=>{
 for(const p of [{contactFormId:31},{contactNameField:' ',interactions:{contact:{emailField:''}}}])assert.throws(()=>schemaExpectations(p,contactFields('[text* your-name]')),/BLOCKED: contact field expectations required/);
});
