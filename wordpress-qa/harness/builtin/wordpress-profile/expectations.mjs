import {ensure} from './helpers.mjs';

export function schemaExpectations(profile, fields) {
 if(profile.contactExpectedFields){
  const expectations=profile.contactExpectedFields;
  ensure(expectations.length>0,'BLOCKED: contact field expectations required');
  return {expectations,missing:expectations.filter(e=>!fields.some(f=>f.name===e.name&&f.type===e.type&&f.required===e.required)),scope:'Publicly declared field types and required flags agree with the admin form; optional fields are not inferred to be required.'};
 }
 const c=profile.interactions?.contact??{};
 const expectations=[
  {name:c.nameField??profile.contactNameField,type:'text',required:true},
  {name:c.emailField??profile.contactEmailField,type:'email',required:true},
  {name:c.messageField??profile.contactMessageField,type:'textarea',required:true},
  {name:c.consentField??profile.contactConsentField,type:'acceptance',required:true}
 ].filter(e=>typeof e.name==='string'&&e.name.trim());
 ensure(expectations.length>0,'BLOCKED: contact field expectations required; configure the CF7 field names before checking the schema');
 return {expectations,missing:expectations.filter(e=>!fields.some(f=>f.name===e.name&&f.type===e.type&&f.required===e.required))};
}
export function inventoryPolicy(profile) {
 const i=profile.interactions?.inventory??{};
 const postTypes=i.postTypes??['post','page'];
 ensure(Array.isArray(postTypes)&&postTypes.length>0&&postTypes.every(t=>/^[a-zA-Z0-9_-]+$/.test(t)), 'BLOCKED: inventory postTypes required');
 return {postTypes,supplementalPaths:i.supplementalPaths??[],componentRedirects:i.componentRedirects??[]};
}
