import fs from 'node:fs';
const base='../../debug-evidence/mannendo-staging',file=base+'/site.json',c=JSON.parse(fs.readFileSync(file));
const names={inventory:'CMS公開データとURL台帳の照合（REST4投稿型）','contact-schema':'問い合わせ必須・形式・同意の管理設定','post-lifecycle':'標準投稿の公開・更新・非公開と管理者表示の更新',scheduled:'標準投稿の予約前・予約後の状態遷移'};
for(const [kind,title]of Object.entries(names)){
 const id='admin-progress-'+kind;fs.writeFileSync(`${base}/operations/${id}.mjs`,`import {runAdmin} from './admin-progress.mjs';export const run=args=>runAdmin(${JSON.stringify(kind)},args);\n`);
 const j={id,title,module:`operations/${id}.mjs`,required:true,handlesAuthentication:true};const i=c.journeys.findIndex(x=>x.id===id);if(i<0)c.journeys.push(j);else c.journeys[i]=j;
}
fs.writeFileSync(file,JSON.stringify(c,null,2));
