// Mark the live DOM only for evidence capture. Do not change site data or saved pixels.
export async function captureMarkedScreenshots(page,violations,save){
  const shots=[];let number=0;
  for(const violation of violations)for(const node of violation.nodes??[]){
    const shot={id:`marked-${String(++number).padStart(3,'0')}`,number,rule:violation.id,target:node.target,html:node.html,url:page.url(),capturedAt:new Date().toISOString(),viewport:page.viewportSize()};
    let overlay;
    try{
      if(node.target?.length!==1||typeof node.target[0]!=='string')throw Error('iframe・Shadow DOMの対象は自動枠付け未対応');
      const locator=page.locator(node.target[0]);
      if(await locator.count()!==1)throw Error('対象要素を一意に特定できません');
      await locator.scrollIntoViewIfNeeded({timeout:3000});
      const box=await locator.boundingBox();if(!box||box.width<=0||box.height<=0)throw Error('対象要素が非表示です');
      const viewport=page.viewportSize();
      if(viewport&&(box.x>=viewport.width||box.y>=viewport.height||box.x+box.width<=0||box.y+box.height<=0))throw Error('対象要素が画面外にあり枠を表示できません');
      shot.box=box;
      overlay=await page.evaluateHandle(({box,number})=>{
        const layer=document.createElement('div');layer.setAttribute('aria-hidden','true');
        Object.assign(layer.style,{position:'fixed',left:`${box.x}px`,top:`${box.y}px`,width:`${box.width}px`,height:`${box.height}px`,outline:'3px solid #e00028',outlineOffset:'2px',zIndex:'2147483647',pointerEvents:'none',boxSizing:'border-box'});
        const label=document.createElement('span');label.textContent=`指摘 ${number}`;
        Object.assign(label.style,{position:'absolute',left:'0',top:box.y>=28?'-28px':'0',background:'#a8001e',color:'#fff',font:'bold 14px sans-serif',padding:'3px 6px',whiteSpace:'nowrap'});
        layer.append(label);document.documentElement.append(layer);return layer;
      },{box,number});
      await save(shot.id,await page.screenshot({type:'png',animations:'disabled'}));
      shot.status='captured';
    }catch(error){shot.status='unavailable';shot.reason=error.message;}
    finally{if(overlay){await overlay.evaluate(el=>el.remove()).catch(()=>{});await overlay.dispose();}}
    shots.push(shot);
  }
  return shots;
}
