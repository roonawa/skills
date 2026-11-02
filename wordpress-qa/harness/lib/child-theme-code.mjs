import {load} from 'cheerio';
import {createHash} from 'node:crypto';
const input=String.raw`\$_(?:GET|POST|REQUEST|COOKIE)\s*\[`;
const rules=[
 ['output','入力値の直接出力',new RegExp(String.raw`(?:\becho|\bprint|<\?=)\s*`+input,'g'),'表示する文脈に合わせてesc_html・esc_attr等でエスケープしてください。'],
 ['command','入力値を使ったコード・コマンド実行',new RegExp(String.raw`\b(?:eval|system|exec|shell_exec|passthru|unserialize)\s*\(\s*`+input,'g'),'外部入力を実行処理へ渡さず、許可した固定処理に置き換えてください。'],
 ['include','入力値を使ったファイル読み込み',new RegExp(String.raw`\b(?:include|include_once|require|require_once)\s*\(?\s*`+input,'g'),'読み込むファイルを固定の許可リストで制限してください。'],
 ['sql','SQLへの入力値の直接受け渡し',new RegExp(String.raw`\$wpdb\s*->\s*(?:query|get_results|get_row|get_var)\s*\(\s*`+input,'g'),'SQLの構造を固定し、wpdbのprepare等でパラメーターを処理してください。'],
 ['dom','URL由来の値をHTMLとして挿入',/\b(?:innerHTML\s*=\s*|document\.write\s*\(\s*)(?:window\.)?location\b/g,'文字列として表示する場合はtextContentを使用し、HTMLの入力を制限してください。']
];
export const scope='管理画面で取得できたPHP・JavaScriptの直接的な危険パターンの簡易静的検査です。検出は脆弱性の確定ではありません。変数を介したデータフロー、権限・nonceの妥当性、実行条件、配布元との差分、未取得ファイルは別途確認が必要です。CSSは取得記録のみです。';
export function scanChildCode(file,source){
 // Mask comments and quoted literals, preserving source offsets and lines.
 const code=source.replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*?\1|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*/g,s=>s.replace(/[^\n]/g,' '));
 const findings=[];
 if(/\.(php|js)$/i.test(file))for(const [rule,title,pattern,fix] of rules){
  pattern.lastIndex=0;for(const match of code.matchAll(pattern))findings.push({file,line:code.slice(0,match.index).split('\n').length,rule,title,fix,certainty:'要確認'});
 }
 return {file,bytes:Buffer.byteLength(source),lines:source.split('\n').length,sha256:createHash('sha256').update(source).digest('hex'),findings:findings.sort((a,b)=>a.line-b.line)};
}
function validFile(s){return typeof s==='string'&&s.length<240&&/^(?:[\w.-]+\/)*[\w.-]+\.(php|js|css)$/i.test(s)&&s.split('/').every(p=>p!=='.'&&p!=='..');}
export async function inspectChildTheme(asset,get,editorURL='https://editor.invalid/wp-admin/theme-editor.php'){
 const result={files:[],findings:[],incomplete:[],scope};
 if(!/^[a-z0-9_-]+$/i.test(asset.slug??'')){result.incomplete.push('子テーマの識別子を確認できません');return result;}
 const base=editorURL;
 try{
  const html=await get('theme-editor.php?theme='+encodeURIComponent(asset.slug));const $=load(html);
  const selected=$('#template [name=file]').val();
  const listed=new Set(validFile(selected)?[selected]:[]);
  $('a[href]').each((_,el)=>{try{const u=new URL($(el).attr('href'),base);if(u.pathname!==new URL(base).pathname||u.searchParams.get('theme')!==asset.slug)return;const f=u.searchParams.get('file');if(u.origin!==new URL(base).origin||!validFile(f)){result.incomplete.push('対象外のファイルリンクを除外しました');return;}listed.add(f);}catch{}});
  if(!listed.size){result.incomplete.push('テーマエディターのファイル一覧を取得できません。権限や編集無効化の設定を確認してください（検査のために有効化する必要はありません）');return result;}
  if(listed.size>30)result.incomplete.push('取得上限30ファイルを超えました');
  let total=0;
  for(const file of [...listed].slice(0,30)){
   try{
    const doc=file===selected?$:load(await get('theme-editor.php?theme='+encodeURIComponent(asset.slug)+'&file='+encodeURIComponent(file)));
    if(doc('#template [name=theme]').val()!==asset.slug||doc('#template [name=file]').val()!==file||doc('#newcontent').length!==1){result.incomplete.push(file+'：要求したテーマ・ファイルの本文を確認できません');continue;}
    const source=doc('#newcontent').val();const size=Buffer.byteLength(source);
    if(size>1024*1024||total+size>2*1024*1024){result.incomplete.push(file+'：取得容量の上限を超えました');continue;}total+=size;
    const {findings,...record}=scanChildCode(file,source);result.files.push(record);result.findings.push(...findings);
   }catch{result.incomplete.push(file+'：管理画面から読み取れませんでした');}
  }
 }catch{result.incomplete.push('子テーマのエディターを読み取れませんでした。認証・権限・編集無効化を確認してください');}
 return result;
}
