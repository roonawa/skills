const supported=new Set(['frame-title','color-contrast','scrollable-region-focusable','image-alt','link-name','button-name','label']);
export async function collectAccessibilityImpact(page,initial,repeat){
 const evidence={schema:'wpqa-accessibility-impact-v1',scope:'observed-elements-only',observations:[],unverified:[]};
 let repeated;try{repeated=await repeat();}catch{evidence.unverified.push('再検査を取得できません');return evidence;}
 for(const violation of initial.violations??[]){
  if(!supported.has(violation.id))continue;
  for(const node of (violation.nodes??[]).slice(0,30)){
   const target=node.target;
   if(!Array.isArray(target)||target.length!==1||typeof target[0]!=='string'){evidence.unverified.push(violation.id+'：フレーム・Shadow DOM内は追加確認');continue;}
   const stable=(repeated.violations??[]).some(v=>v.id===violation.id&&v.nodes?.some(n=>JSON.stringify(n.target)===JSON.stringify(target)));
   if(!stable)continue;
   try{
    const locator=page.locator(target[0]);if(await locator.count()!==1)continue;
    const facts=await locator.evaluate(el=>{
     const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
     const s=getComputedStyle(el),r=el.getBoundingClientRect();
     const labelled=[el.getAttribute('aria-label'),el.getAttribute('title'),...(el.getAttribute('aria-labelledby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent)].some(v=>v?.trim());
     return {tag:el.tagName,visible:visible(el),labelled,textPresent:!!el.textContent?.trim(),altPresent:!!el.getAttribute('alt')?.trim(),overflow:el.scrollHeight>el.clientHeight+2&&['auto','scroll'].includes(s.overflowY),tabIndex:el.tabIndex,focusableDescendants:[...el.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&visible(e)).length};
    });
    let keyboardBlocked=false;
    if(violation.id==='scrollable-region-focusable'&&facts.visible&&facts.overflow&&facts.tabIndex<0&&facts.focusableDescendants===0){
     keyboardBlocked=await locator.evaluate(el=>{const previous=document.activeElement;el.focus();const blocked=document.activeElement!==el;previous?.focus?.();return blocked;});
    }
    const contrast=(node.any??[]).concat(node.all??[]).find(c=>c.id==='color-contrast')?.data;
    evidence.observations.push({rule:violation.id,target:target[0],repeated:true,...facts,keyboardBlocked,...(contrast?{contrastRatio:Number(contrast.contrastRatio),expectedRatio:parseFloat(contrast.expectedContrastRatio)}:{})});
   }catch{evidence.unverified.push(violation.id+'：要素を確認できません');}
  }
 }
 return evidence;
}
export function impactAssessments(data){
 const output=[];
 if(data?.schema==='wpqa-accessibility-impact-v1'&&data.scope==='observed-elements-only'){
  for(const o of Array.isArray(data.observations)?data.observations:[]){
   if(!supported.has(o.rule)||o.repeated!==true||o.visible!==true)continue;
   let impact,observation;
   if(o.rule==='frame-title'&&o.tag==='IFRAME'&&o.labelled===false){impact=2;observation='表示中のiframeに識別用の名前がなく、axeでも同じ要素の違反を2回確認。';}
   if(o.rule==='color-contrast'&&o.textPresent===true&&Number.isFinite(o.contrastRatio)&&Number.isFinite(o.expectedRatio)&&o.contrastRatio>=1&&o.expectedRatio>o.contrastRatio){impact=2;observation='表示文字のコントラスト比 '+o.contrastRatio+' が基準 '+o.expectedRatio+' 未満。同じ要素で2回確認。';}
   if(o.rule==='scrollable-region-focusable'&&o.keyboardBlocked===true&&o.overflow===true&&o.tabIndex<0&&o.focusableDescendants===0){impact=3;observation='縦スクロール領域にフォーカスを移せず、表示中のフォーカス可能な子要素もない。同じ違反を2回確認。';}
   if(o.rule==='image-alt'&&o.tag==='IMG'&&o.altPresent===false&&o.labelled===false){impact=2;observation='表示中の画像に代替テキスト・名前がなく、同じ要素の違反を2回確認。';}
   if(['link-name','button-name'].includes(o.rule)&&['A','BUTTON','INPUT'].includes(o.tag)&&o.labelled===false&&o.textPresent===false){impact=2;observation='表示中の操作要素に識別用の名前がなく、同じ要素の違反を2回確認。';}
   if(!impact)continue;
   output.push({key:'axe:'+o.rule,scores:[impact,3,2],observation,reasons:[
    impact===3?'スクロール領域へのフォーカス移動が成立しないことを検査で確認。検査したキーボードアクセス経路が利用できないため影響度3。別経路での回避は未確認。':'表示対象の識別情報または文字の判読性の欠落を直接確認したため、その欠落自体を影響度2で暫定評価。主要操作不能や情報漏えいを評価した点数ではありません。',
    '同じ要素の違反を2回検出し、DOMの状態を確認しました。支援技術・視認・キーボードの条件に依存する問題として成立容易性3。',
    '確認した要素を使う利用者と、その要素へのアクセスに評価範囲を限定するため範囲2。URL件数から全サイトへの波及を推定していません。'
   ],scope:'観測した要素のアクセシビリティ障壁だけの暫定評価です。業務操作全体・他要素・他端末への影響は別途確認が必要です。'});
  }
 }
 if(data?.schema==='wpqa-document-impact-v1'&&data.statuses?.length===2&&data.statuses.every(s=>s===200)&&data.repeated===true&&typeof data.path==='string'){
  for(const type of data.findings??[]){
   const labels={'fragment-missing':'ページ内リンク先がありません','title-empty':'ページタイトルがありません','lang-missing':'文書の言語指定がありません'};
   if(!labels[type]||(type==='fragment-missing'&&data.browserConfirmed!==true))continue;
   output.push({key:'document:'+type+':'+data.path,title:labels[type],scores:[2,type==='fragment-missing'?4:3,1],observation:'同じ文書をHTTP 200で2回取得し、'+labels[type]+'ことを両回で確認。',reasons:[
    '文書内の補助的な移動・識別情報の欠落を2回確認したため影響度2。ページ全体の閲覧不能を示す証拠ではありません。',
    type==='fragment-missing'?'同一ページ内のリンクと移動先IDの不一致を2回確認。通常のリンク操作に関わるため成立容易性4。':'文書の識別・言語情報の欠落を2回確認。支援技術等が利用する条件として成立容易性3。',
    '単一文書内の補助情報の不一致だけを対象とするため範囲1。他ページへの影響はこの評価に含めません。'
   ],scope:'取得した文書の補助情報だけの暫定評価。JavaScriptによる動的な補完や業務操作への影響は未確認です。'});
  }
 }
 return output;
}
export async function confirmFragmentTargets(page,errors){
 const fragments=errors.filter(e=>e.startsWith('fragment target missing: ')).map(e=>e.slice('fragment target missing: '.length)).slice(0,5),confirmed=[];
 for(const fragment of fragments){
  try{
   const anchors=page.locator('a[href]');let clicked=false;
   for(let i=0;i<await anchors.count();i++){
    const a=anchors.nth(i);const eligible=await a.evaluate((el,f)=>{const u=new URL(el.href),now=new URL(location.href);return u.origin===now.origin&&u.pathname===now.pathname&&u.search===now.search&&decodeURIComponent(u.hash.slice(1))===decodeURIComponent(f)&&!el.hasAttribute('onclick')&&!el.hasAttribute('aria-controls')&&!el.hasAttribute('download')&&!el.hasAttribute('target');},fragment);
    if(!eligible||!await a.isVisible())continue;
    await a.click({timeout:3000});clicked=true;break;
   }
   if(clicked&&await page.evaluate(f=>decodeURIComponent(location.hash.slice(1))===decodeURIComponent(f)&&!document.getElementById(decodeURIComponent(f))&&![...document.getElementsByName(decodeURIComponent(f))].length,fragment))confirmed.push(fragment);
  }catch{}
 }
 return confirmed.length>0;
}
