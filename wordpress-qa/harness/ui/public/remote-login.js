export function remoteLoginView({container,api}){
  const box=document.createElement('section');box.className='remote-login';box.hidden=true;
  box.innerHTML='<h4>WordPressのログイン画面</h4><p>下の画面の入力欄をクリックして入力します。日本語や貼り付けは下の入力欄から送れます。ログイン後、上の「ログインを確認」を押し、最後に設定の「保存」を押してください。操作期限は開始から10分です。</p><p>別サイトのSSO・外部画像認証、別ウィンドウ、端末のパスキーは未対応です。画面が進まない場合はキャンセルして担当者に相談してください。</p><canvas width="1100" height="760" tabindex="0" aria-label="WordPressの遠隔ログイン画面。クリックまたはTabキーで入力欄を選択"></canvas><label>選んだ入力欄へ送る文字（送信後に消去）<input data-remote-text type="password" autocomplete="off" maxlength="2048"></label><button type="button" data-send>文字を入力</button><button type="button" data-tab>次の入力欄へ</button><button type="button" data-enter>Enter</button><button type="button" data-clear>選択中の欄を空にする</button><p data-message role="status"></p>';
  container.append(box);const canvas=box.querySelector('canvas'),input=box.querySelector('input'),message=box.querySelector('[data-message]');
  let id=null,timer=null,generation=0,queue=Promise.resolve();
  function send(data){const current=generation;queue=queue.then(()=>perform(data,current));return queue;}
  async function perform(data,current){
    if(!id||current!==generation)return;
    try{
      const result=await api('/api/logins/'+encodeURIComponent(id)+'/operate',{method:'POST',body:JSON.stringify(data)});
      if(current!==generation)return;
      if(result.image){
        const bytes=Uint8Array.from(atob(result.image),c=>c.charCodeAt(0));
        const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
        if(current===generation)canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
      }
      message.textContent='';return true;
    }catch(e){if(current===generation){message.textContent=e.message;if(/期限切れ|終了|別の利用者/.test(e.message)){id=null;clearTimeout(timer);input.value='';canvas.getContext('2d').clearRect(0,0,1100,760);}}}
  }
  function poll(){clearTimeout(timer);if(!id)return;timer=setTimeout(async()=>{await send({type:'frame'});poll();},900);}
  canvas.onclick=async e=>{canvas.focus();const r=canvas.getBoundingClientRect();await send({type:'click',x:Math.min(1099,Math.max(0,(e.clientX-r.left)*1100/r.width)),y:Math.min(759,Math.max(0,(e.clientY-r.top)*760/r.height))});};
  canvas.onkeydown=async e=>{
    if(e.isComposing)return;
    const special=['Tab','Enter','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'];
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();await send({type:'key',key:'Control+A'});}
    else if(special.includes(e.key)){e.preventDefault();await send({type:'key',key:e.shiftKey&&e.key==='Tab'?'Shift+Tab':e.key});}
    else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();await send({type:'text',text:e.key});}
  };
  canvas.addEventListener('wheel',e=>{e.preventDefault();void send({type:'scroll',y:Math.max(-1000,Math.min(1000,e.deltaY))});},{passive:false});
  box.querySelector('[data-send]').onclick=async()=>{if(input.value&&await send({type:'text',text:input.value}))input.value='';};
  box.querySelector('[data-tab]').onclick=()=>send({type:'key',key:'Tab'});
  box.querySelector('[data-enter]').onclick=()=>send({type:'key',key:'Enter'});
  box.querySelector('[data-clear]').onclick=async()=>{if(await send({type:'key',key:'Control+A'}))await send({type:'key',key:'Backspace'});};
  function stop(){generation++;id=null;clearTimeout(timer);box.hidden=true;input.value='';canvas.getContext('2d').clearRect(0,0,1100,760);}
  return {start(value){stop();id=value;box.hidden=false;void send({type:'frame'});poll();},stop};
}
