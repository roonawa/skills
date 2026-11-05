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
const FIELDS=['title','summary','impact','steps','location','note'];
const trimUrl=u=>u.replace(/[.,;:]+$/,'');
const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

const texts=item=>FIELDS.flatMap(f=>{const v=item?.[f];return Array.isArray(v)?v.filter(s=>typeof s==='string'):typeof v==='string'?[v]:[];});
const strings=(v,out=[])=>{if(v==null)return out;if(typeof v==='object')for(const x of Object.values(v))strings(x,out);else out.push(String(v));return out;};
const poolOf=group=>strings([group?.facts,group?.verification?.notes]).join('\n');
const sentences=t=>t.split(/[。！？\n]/).map(s=>({raw:s.trim(),key:s.replace(/[\s、。・「」（）]/g,'')})).filter(s=>s.key.length>=6);

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
    for(const m of body.matchAll(INTERNAL_ID))if(!(/\.[A-Za-z]{2,}$/.test(m[0])&&pool.includes(m[0])))add(groupId,'code',`内部の識別子：${m[0]}`);

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
        if(!/^（[^）]+）/.test(plain.slice(m.index+term.length)))add(groupId,'term',`用語「${term}」の直後に全角括弧の説明がありません`);
      }
    }

    for(const f of unknownFacts(body,pool))add(groupId,'unknown-fact',`渡していない事実の可能性があります：${f}`);
  }
  return problems;
}
