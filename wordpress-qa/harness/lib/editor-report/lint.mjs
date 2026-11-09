// Claude が書いた編集者向けの文章を、読みにくい書き方・渡していない事実・項目の過不足について機械的に確かめる。
export const TERMS=['HSTS','CSP','CVE','REST','XML-RPC','CDATA','CSRF','XSS','egress','noindex','canonical','JavaScript','HTTP'];

const CODE=[
  [/expect\(/,'expect('],[/Error:/,'Error:'],[/AssertionError/,'AssertionError'],[/Timeout \d+ms/,'Timeout …ms'],
  [/^[ \t]*at\s/m,'スタックの行'],[/[{}]/,'{ }'],[/\x1b/,'\\x1b'],
];
const INTERNAL_ID=/(?<![\w.-])(?:check|page|journey|links|admin|layout|axe|snapshot|javascript)\.[\w.-]*[A-Za-z0-9_-]/g;
const URL_RE=/https?:\/\/[^\s、。，！？）)」』"'<>]+/g;
const CVE_RE=/CVE-\d{4}-\d+/g;
const FILE_EXT=/^(?:php|html?|txt|xml|json|jsx?|mjs|css|png|jpe?g|gif|svg|webp|pdf|ico|md|ya?ml|ini|log|zip)$/i;
const DOMAIN_RE=/(?<![\w@.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?![\w-])/gi;
const VERSION_RE=/(?<![\w.])\d+\.\d+(?:\.\d+)*(?![\w]|\.\d)/g;
// 内部IDと見分けるため、渡した事実にあるドメイン名として許す最後の語はこの一覧だけ。
const REAL_TLDS=new Set(['com','net','org','info','biz','io','co','jp','dev','app','me','us','uk','de','fr','cn','kr','tw','au','ca','eu','xyz','site','online','tech','shop','test','invalid','localhost']);
const FIELDS=['title','summary','impact','steps','location','note'];
const trimUrl=u=>u.replace(/[.,;:]+$/,'');
const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

const texts=item=>FIELDS.flatMap(f=>{const v=item?.[f];return Array.isArray(v)?v.filter(s=>typeof s==='string'):typeof v==='string'?[v]:[];});
const strings=(v,out=[])=>{if(v==null)return out;if(typeof v==='object')for(const x of Object.values(v))strings(x,out);else out.push(String(v));return out;};
const poolOf=group=>strings([group?.facts,group?.verification?.notes]).join('\n');
const sentences=t=>t.split(/[。！？\n]/).map(s=>({raw:s.trim(),key:s.replace(/[\s、。・「」（）]/g,'')})).filter(s=>s.key.length>=6);

// 同じ文が2回目以降に出たら機械的に取り除く（最初の1回と題名は残す）。読む順（項目順・FIELDS順）で判定する。
// Claude に書き直させても同じ文を繰り返すことがあるため、確認の前にここで重複をなくす。
const sentenceKey=t=>t.replace(/[\s、。・「」（）！？]/g,'');
export function dropRepeatedSentences(items){
  const seen=new Set();let removed=0;
  const note=t=>{for(const part of String(t).split(/[。！？\n]/)){const k=sentenceKey(part);if(k.length>=6)seen.add(k);}};
  const clean=t=>{
    if(typeof t!=='string')return t;
    const kept=t.split(/(?<=[。！？\n])/).filter(part=>{const k=sentenceKey(part);if(k.length<6)return true;if(seen.has(k)){removed++;return false;}seen.add(k);return true;});
    return kept.join('').trim();
  };
  const out=(Array.isArray(items)?items:[]).map(it=>{
    if(!it||typeof it!=='object')return it;
    const next={...it};
    if(typeof it.title==='string')note(it.title);
    for(const f of FIELDS.slice(1)){
      if(Array.isArray(it[f]))next[f]=it[f].map(clean).filter(x=>typeof x!=='string'||x);
      else next[f]=clean(it[f]);
    }
    return next;
  });
  return {items:out,removed};
}

// 渡していない事実（URL・CVE・ドメイン名・版番号）を含む文を機械的に取り除く（題名は残す）。
// 取り除いた文の語は、根拠ページに載せて確認できるようにする。
export function dropUnknownFactSentences(items,groups=[]){
  const byId=new Map(groups.map(g=>[g.id,g])),removed=[];
  const out=(Array.isArray(items)?items:[]).map(it=>{
    if(!it||typeof it!=='object')return it;
    const pool=poolOf(byId.get(it.groupId)),next={...it};
    const clean=t=>{
      if(typeof t!=='string')return t;
      return t.split(/(?<=[。！？\n])/).filter(part=>{const facts=unknownFacts(part,pool);if(!facts.length)return true;removed.push({groupId:String(it.groupId),facts});return false;}).join('').trim();
    };
    for(const f of FIELDS.slice(1)){
      if(Array.isArray(it[f]))next[f]=it[f].map(clean).filter(x=>typeof x!=='string'||x);
      else next[f]=clean(it[f]);
    }
    return next;
  });
  return {items:out,removed};
}

// 用語の説明が抜けていたら、報告書で最初に出る箇所の直後に決まった説明を付ける（lint と同じ判定）。
const GLOSSARY={HSTS:'常に暗号化した通信で接続させる設定',CSP:'読み込んでよい外部ファイルを限定する設定',CVE:'公開されている弱点の識別番号',REST:'外部からサイトの情報を読み書きする仕組み','XML-RPC':'外部から投稿などを操作する古い仕組み',CDATA:'文字をそのまま扱うための書き方',CSRF:'利用者になりすまして操作させる攻撃',XSS:'ページに不正なスクリプトを埋め込む攻撃',egress:'外部への接続',noindex:'検索結果に出さない設定',canonical:'正式なページのアドレスを示す設定',JavaScript:'ページを動かすためのプログラム',HTTP:'ウェブの通信の決まり'};
const termAt=(term,text)=>{
  const plain=text.replace(URL_RE,u=>' '.repeat(u.length));
  const m=new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(term)}(?![A-Za-z0-9_]|-\\d)`).exec(plain);
  if(!m)return null;
  const after=plain.slice(m.index+term.length),explained=/^（[^）]+）/.test(after)||(plain.slice(0,m.index).endsWith('（')&&after.startsWith('）')&&m.index>1);
  return {index:m.index,explained};
};
export function explainTerms(items){
  const done=new Set(),added=[];
  const out=(Array.isArray(items)?items:[]).map(it=>{
    if(!it||typeof it!=='object')return it;
    const next={...it};
    const fix=t=>{
      if(typeof t!=='string')return t;
      for(const term of TERMS){
        if(done.has(term))continue;
        const hit=termAt(term,t);if(!hit)continue;
        done.add(term);
        if(!hit.explained&&GLOSSARY[term]){const at=hit.index+term.length;t=t.slice(0,at)+'（'+GLOSSARY[term]+'）'+t.slice(at);added.push({groupId:String(it.groupId),term});}
      }
      return t;
    };
    for(const f of FIELDS){if(Array.isArray(it[f]))next[f]=it[f].map(fix);else next[f]=fix(it[f]);}
    return next;
  });
  return {items:out,added};
}

// 書き直さない項目で使った文。書き直しで同じ文を書かないよう Claude に渡す。
export const usedSentences=items=>[...new Set((Array.isArray(items)?items:[]).flatMap(texts).flatMap(sentences).map(s=>s.raw))];

// 本文の URL・CVE・ドメイン名・版番号のうち、そのグループの facts と verification.notes にないものを返す。
function unknownFacts(text,pool){
  const lower=pool.toLowerCase(),missing=[];
  const check=(s,given)=>{if(!given&&!missing.includes(s))missing.push(s);};
  let rest=text;
  for(const m of rest.match(URL_RE)??[]){const u=trimUrl(m);check(u,pool.includes(u));}
  rest=rest.replace(URL_RE,' ');
  for(const m of rest.match(CVE_RE)??[])check(m,pool.includes(m));
  rest=rest.replace(CVE_RE,' ');
  for(const m of rest.match(DOMAIN_RE)??[]){
    if(FILE_EXT.test(m.slice(m.lastIndexOf('.')+1))||/^\d+(?:\.\d+)+$/.test(m))continue;
    check(m,lower.includes(m.toLowerCase()));
  }
  rest=rest.replace(DOMAIN_RE,' ');
  for(const m of rest.match(VERSION_RE)??[])check(m,pool.includes(m));
  return missing;
}

export function lintItems(items,{groups=[]}={}){
  const list=Array.isArray(items)?items:[];
  const byId=new Map(groups.map(g=>[g.id,g]));
  const problems=[];
  const add=(groupId,problem,detail)=>{if(!problems.some(p=>p.groupId===groupId&&p.problem===problem&&p.detail===detail))problems.push({groupId,problem,detail});};

  // 1グループにつき項目はちょうど1件。
  const counts=new Map();
  for(const it of list)counts.set(it?.groupId,(counts.get(it?.groupId)??0)+1);
  for(const g of groups)if(!counts.has(g.id))add(g.id,'missing','このグループの項目がありません');
  for(const [id,n] of counts){
    if(!byId.has(id))add(String(id),'extra','渡していないグループの項目です');
    else if(n>1)add(id,'extra',`このグループの項目が${n}件あります`);
  }

  const seen=new Set(),explained=new Set();
  for(const it of list){
    const groupId=String(it?.groupId),all=texts(it),pool=poolOf(byId.get(it?.groupId)),body=all.join('\n');

    for(const [re,label] of CODE)if(re.test(body))add(groupId,'code',`編集者向けの文章に出してはいけない文字列：${label}`);
    for(const m of body.matchAll(INTERNAL_ID))if(!(REAL_TLDS.has(m[0].slice(m[0].lastIndexOf('.')+1).toLowerCase())&&pool.includes(m[0])))add(groupId,'code',`内部の識別子：${m[0]}`);

    // 同じ文は報告書全体で1回だけ。
    for(const s of all.flatMap(sentences)){
      if(seen.has(s.key))add(groupId,'duplicate',`同じ文が重複しています：${s.raw}`);
      else seen.add(s.key);
    }

    // 用語は報告書で最初に出る箇所の直後に全角括弧の説明が要る。2回目以降は用語だけでよい。
    for(const t of all){
      const plain=t.replace(URL_RE,' ');
      for(const term of TERMS){
        if(explained.has(term))continue;
        const m=new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(term)}(?![A-Za-z0-9_]|-\\d)`).exec(plain);
        if(!m)continue;
        explained.add(term);
        // 「用語（説明）」と「説明（用語）」のどちらも説明とみなす。
        const after=plain.slice(m.index+term.length),bracketed=plain.slice(0,m.index).endsWith('（')&&after.startsWith('）')&&m.index>1;
        if(!bracketed&&!/^（[^）]+）/.test(after))add(groupId,'term',`用語「${term}」の直後に全角括弧の説明がありません`);
      }
    }

    for(const f of unknownFacts(body,pool))add(groupId,'unknown-fact',`渡していない事実の可能性があります：${f}`);
  }
  return problems;
}
