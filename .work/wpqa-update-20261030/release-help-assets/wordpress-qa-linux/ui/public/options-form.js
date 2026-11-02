const f=(label,type='text',extra={})=>({label,type,...extra});
const strings=label=>f(label,'strings'),obj=(label,fields)=>f(label,'object',{fields}),arr=(label,fields,item)=>f(label,'array',{fields,item});
const path=f('対象パス'),status=f('期待HTTP状態','number'),instructions=f('確認手順','textarea');
const probe={url:f('検証URL'),status,bodyIncludes:f('期待文字列（実行IDは {{token}}）')};
const source={url:f('メールAPI URL'),headersEnv:f('メールAPI認証名')};
const expected={to:f('宛先'),subject:f('件名（{{token}}で相関）'),textIncludes:f('本文の期待文字列'),count:f('期待通数','number'),timeoutMs:f('待機 ms','number'),settleMs:f('追加到着待ち ms','number'),attachments:obj('添付確認',{count:f('期待件数','number'),names:strings('期待ファイル名（1行1件）')})};
const step={action:f('操作','select',{choices:['goto','fill','click','check','select','press','setInputFiles','assertVisible','assertText','assertCount','assertURL','assertAttribute','assertRequest','waitForMail']}),selector:f('対象要素（CSS）'),url:f('移動先・assertRequestの正確な送信先URL（クエリは別欄）'),method:f('assertRequestのHTTPメソッド','select',{choices:['GET','HEAD','POST','PUT','PATCH','DELETE']}),query:f('assertRequestのクエリ期待値（名前=文字列）','pairs'),body:f('assertRequestの本文期待値（JSONまたはフォーム。型付き値は詳細JSON）','pairs'),timeoutMs:f('通信確認の最大待機ms（100〜30000）','number'),settleMs:f('追加通信の確認ms（50〜5000、最大待機以下）','number'),value:f('入力値・期待値','textarea'),count:f('期待件数','number'),name:f('属性名・添付ファイル名'),mimeType:f('添付MIMEタイプ'),source:obj('メールAPI',source),expected:obj('配送期待値',expected)};
const wp={postType:f('投稿RESTコレクション（posts / pages等）'),headersEnv:f('管理者REST認証名'),storageStateEnv:f('管理者ブラウザー認証名'),maxWaitMs:f('最大待機 ms','number'),pollIntervalMs:f('確認間隔 ms','number')};
const schemas={
 'discovered-public':{area:f('自動取得した検査範囲','select',{choices:['navigation','contact-errors','contact-retry','crawl']}),path},
 'site-interaction':{operation:f('共通操作','select',{choices:['all-links','search-product','search-empty','search-special','menu','menu-navigation','contact-validation','server-validation','network-failure','keyboard','firefox','performance','public-discovery','cart-limit','customer-empty']})},
 'standard-public':{area:f('検査範囲','select',{choices:['metadata','navigation','forms','keyboard','integrations','multilingual','performance','crawl']}),paths:strings('代表ページ（最大5件・1行1パス）')},
 'unconfigured':{instructions},'human-review':{instructions},
 'wp-lifecycle':wp,'wp-scheduled':{...wp,scheduleDelayMs:f('公開までの時間 ms（通常120000以上）','number')},
 'wp-cache':{...wp,listingURLs:strings('一覧URL（1行1件）'),searchURLs:strings('検索URL（1行1件）'),cacheRoles:arr('確認ロール',{role:f('ロール名'),storageStateEnv:f('ブラウザー認証名'),canReadPrivate:f('非公開を閲覧できる','boolean')},{role:'subscriber',storageStateEnv:'WPQA_ROLE_SUBSCRIBER_STATE',canReadPrivate:false})},
 'wp-authz':{...wp,role:f('検査ロール名'),roleHeadersEnv:f('ロールREST認証名'),expectedUserId:f('期待ユーザーID','number'),expectedRoles:strings('期待ロール（1行1件）'),ownership:f('所有関係','select',{choices:['other','own']}),readStatus:f('読取HTTP状態','number'),readCode:f('読取拒否コード'),updateStatus:f('更新HTTP状態','number'),updateCode:f('更新拒否コード'),expectations:obj('成功・拒否を個別に指定',{read:obj('読取',{status,code:f('拒否コード')}),update:obj('更新',{status,code:f('拒否コード')})})},
 'redirect':{path,status,location:f('期待転送先')},
 'seo-page':{path,canonical:f('正規URL'),meta:f('meta / OGP','pairs'),jsonLd:arr('構造化データ',{type:f('@type'),properties:f('期待プロパティ','pairs')},{type:'Organization',properties:{name:''}})},
 'seo-robots':{path,rules:arr('robotsルール',{userAgent:f('User-Agent'),directive:f('指示','select',{choices:['allow','disallow']}),value:f('対象パス')},{userAgent:'*',directive:'disallow',value:'/wp-admin/'})},
 'seo-sitemap':{path,requiredUrls:strings('掲載URL（1行1件）'),excludedUrls:strings('除外URL（1行1件）')},
 'performance-navigation':{path,samples:f('測定回数','number'),cache:f('キャッシュ','select',{choices:['cold','warm']}),budgets:obj('許容値',{durationMs:f('ロード ms','number'),resourceCount:f('リソース数','number'),transferBytes:f('転送 bytes','number')})},
 'compatibility-screen':{path,engine:f('ブラウザー','select',{choices:['chromium','firefox','webkit']}),viewport:obj('画面サイズ',{width:f('幅 px','number'),height:f('高さ px','number')}),visible:strings('表示要素（1行1セレクター）'),text:arr('表示文言',{selector:f('対象要素'),value:f('期待文言')},{selector:'h1',value:''}),noOverflow:f('横はみ出しを禁止','boolean')},
 'keyboard-sequence':{path,steps:arr('キー操作',{key:f('キー'),focus:f('フォーカス先'),visible:f('表示要素')},{key:'Tab',focus:'a'})},
 'browser-flow':{roleEnv:f('ブラウザー認証名（例 WPQA_ROLE_MEMBER_STATE）'),sandbox:f('テスト用の外部連携・決済環境を使用','boolean'),allowedResourceOrigins:strings('許可する外部素材のオリジン（https://host、1行1件）'),allowedNavigationOrigins:strings('許可する外部画面のオリジン'),allowedInteractionOrigins:strings('許可する外部送信先のオリジン'),steps:arr('操作手順（上から実行）',step,{action:'goto',url:'/'})},
 'mail-delivery':{source:obj('メールAPI',source),expected:obj('配送期待値',expected)},
 'operation-drill':{adapter:f('登録済みアダプター別名'),operation:f('処理','select',{choices:['update','restore','cron']}),before:obj('実行前',probe),after:obj('実行後',probe)}
};
export function optionsForm(row){
 const editor=row.querySelector('[data-c=options]'),kind=row.querySelector('[data-c=kind]'),form=document.createElement('div');form.className='options-form';editor.parentElement.before(form);
 const get=()=>JSON.parse(editor.value);
 function change(keys,value){const data=get();let parent=data;for(let i=0;i<keys.length-1;i++)parent=parent[keys[i]]??=(typeof keys[i+1]==='number'?[]:{});const last=keys.at(-1);if(value===undefined)delete parent[last];else parent[last]=value;editor.value=JSON.stringify(data,null,2);}
 function render(){
  let data;try{data=get();}catch{form.textContent='詳細JSONを修正すると入力フォームに反映されます。';return;}
  form.replaceChildren();const heading=document.createElement('h4');heading.textContent='対象・期待値を入力';form.append(heading);
  function fields(target,schema,value,keys=[]){
   for(const [key,def] of Object.entries(schema??{})){
    if(row._simplePreparation&&keys[0]==='steps'&&keys.length===2&&value?.action){
     const relevant={goto:['url'],fill:['selector','value'],click:['selector'],check:['selector'],select:['selector','value'],press:['selector','value'],setInputFiles:['selector','name','mimeType','value'],assertVisible:['selector'],assertText:['selector','value'],assertCount:['selector','count'],assertURL:['value'],assertAttribute:['selector','name','value'],assertRequest:['url','method','query','body','count','timeoutMs','settleMs'],waitForMail:['source','expected']}[value.action];
     if(relevant&&key!=='action'&&!relevant.includes(key))continue;
    }
    const friendly=row._simplePreparation?({selector:'操作する入力欄・ボタン',url:keys.includes('source')?'テストメール受信サービスのURL（担当者に確認）':'開くページ・通信先のURL',source:'テストメールの受信サービス',expected:'届いてほしいメール',headersEnv:'保存済みの受信サービス認証名（認証が必要な場合）',to:'メールの宛先',textIncludes:'本文に含まれる文字（テスト識別用の文字は変更不要）',subject:'件名に含まれる文字',method:'送信方法',body:'送信内容（項目名=値、1行1件）',query:'URLに付ける条件（項目名=値、1行1件）',roleEnv:'保存済みの利用者ログイン名',adapter:'担当者が登録した処理名',operation:'実行する処理'}[key]??def.label):def.label;
    const current=value?.[key],trail=[...keys,key];
    if(['object','array'].includes(def.type)){
     const box=document.createElement('details');box.open=current!==undefined;const summary=document.createElement('summary');summary.textContent=friendly;box.append(summary);target.append(box);
     if(def.type==='object'){fields(box,def.fields,current??{},trail);continue;}
     for(const [index,item] of (Array.isArray(current)?current:[]).entries()){
      const compact=row._simplePreparation&&key==='steps';
      const group=document.createElement(compact?'details':'fieldset'),legend=document.createElement(compact?'summary':'legend');legend.textContent=String(index+1)+(compact?'：'+({goto:'ページを開く',fill:'入力する内容',click:'ボタンを押す',check:'チェックを入れる',waitForMail:'メールの到着を確認'}[item.action]??'操作と期待する結果'):'');if(compact)group.open=item.action==='waitForMail'||item.value==='';group.append(legend);fields(group,def.fields,item,[...trail,index]);
      const remove=document.createElement('button');remove.type='button';remove.textContent='この行を削除';remove.onclick=()=>{const next=[...trail.reduce((v,k)=>v?.[k],get())];next.splice(index,1);change(trail,next);render();};group.append(remove);box.append(group);
     }
     const add=document.createElement('button');add.type='button';add.textContent=def.label+'を追加';add.onclick=()=>{change(trail,[...(trail.reduce((v,k)=>v?.[k],get())??[]),structuredClone(def.item)]);render();};box.append(add);continue;
    }
    const label=document.createElement('label');label.textContent=friendly;let input;
    if(def.type==='select'){input=document.createElement('select');input.append(new Option('指定しない',''));const names={goto:'ページを開く',fill:'文字を入力',click:'ボタン・リンクを押す',check:'チェックを入れる',select:'選択肢を選ぶ',press:'キーを押す',setInputFiles:'テストファイルを添付',assertVisible:'要素の表示を確認',assertText:'表示された文字を確認',assertCount:'表示件数を確認',assertURL:'移動先のURLを確認',assertAttribute:'要素の状態を確認',assertRequest:'通信の送信内容と回数を確認',waitForMail:'今回のメール到着を確認',cold:'初回の読込み',warm:'再訪問時の読込み',chromium:'Chrome相当',firefox:'Firefox',webkit:'Safari相当',update:'更新',restore:'復元',cron:'定期処理',allow:'巡回を許可',disallow:'巡回を禁止'};for(const v of def.choices)input.append(new Option(names[v]??v,v));}
    else if(key==='selector'&&row._preparationTargets?.length){input=document.createElement('select');input.append(new Option('対象を選んでください',''));for(const target of row._preparationTargets)input.append(new Option(target.label,target.value));if(current&&!row._preparationTargets.some(t=>t.value===current))input.append(new Option('登録済みの対象',current));}
    else{input=document.createElement(['textarea','strings','pairs'].includes(def.type)?'textarea':'input');if(def.type==='boolean')input.type='checkbox';if(def.type==='number')input.type='number';}
    input.dataset.option=trail.join('.');
    if(def.type==='boolean')input.checked=current===true;
    else input.value=def.type==='strings'?(Array.isArray(current)?current:[]).join('\n'):def.type==='pairs'?Object.entries(current??{}).map(([k,v])=>k+'='+String(v)).join('\n'):current??'';
    if(def.type==='pairs')input.placeholder='og:title=サイト名（1行1項目。複雑な型は詳細JSON）';
    input.onchange=()=>{
     let v=def.type==='boolean'?input.checked:def.type==='number'?(input.value===''?undefined:Number(input.value)):def.type==='strings'?input.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean):def.type==='pairs'?Object.fromEntries(input.value.split(/\r?\n/).filter(Boolean).map(line=>{const i=line.indexOf('=');return i<0?[line,'']:[line.slice(0,i),line.slice(i+1)];})):(key==='value'?input.value:input.value||undefined);
     try{change(trail,v);input.setCustomValidity('');if(key==='action'&&row._simplePreparation)render();}catch{input.setCustomValidity('入力した内容を確認してください');input.reportValidity();}
    };
    label.append(input);
    if(row._simplePreparation&&['roleEnv','headersEnv','sandbox','allowedResourceOrigins','allowedNavigationOrigins','allowedInteractionOrigins'].includes(key)&&current===undefined){const extra=document.createElement('details'),summary=document.createElement('summary');summary.textContent=key==='headersEnv'?'受信サービスへのログインが必要な場合':key==='roleEnv'?'会員としてログインして検査する場合':'外部サービスを使う場合の追加設定';extra.append(summary,label);target.append(extra);}else target.append(label);
   }
  }
  fields(form,schemas[kind.value],data);
 }
 editor.addEventListener('input',render);kind.addEventListener('change',render);row.querySelector('[data-template]').addEventListener('click',()=>queueMicrotask(render));render();
}
