// 表示検査の準備で、読み込めなかった画像（通信失敗・読み込み済みだが幅0）を集める。
const hostOf=url=>{try{return new URL(url).host;}catch{return '';}};
export function trackImages(page) {
  const failed=new Map();
  page.on('requestfailed',req=>{
    // 読み込み中の中断（ページの移動・遅延読み込みの取り消し）は失敗に数えない。
    if(req.resourceType()!=='image'||failed.has(req.url())||req.failure()?.errorText==='net::ERR_ABORTED') return;
    failed.set(req.url(),{url:req.url(),host:hostOf(req.url()),reason:'request-failed'});
  });
  return {async failed() {
    const broken=await page.evaluate(()=>[...document.images].filter(el=>el.currentSrc&&el.complete&&el.naturalWidth===0).map(el=>el.currentSrc)).catch(()=>[]);
    for(const url of broken) if(!failed.has(url)) failed.set(url,{url,host:hostOf(url),reason:'not-loaded'});
    return [...failed.values()];
  }};
}
