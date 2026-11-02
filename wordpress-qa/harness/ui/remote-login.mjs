import {chromium} from '@playwright/test';
import {BrowserLogin} from './browser-login.mjs';

// The server chooses the owner from authenticated HTTP identity, never request data.
export class RemoteLogin extends BrowserLogin {
  constructor(options={}) { super({launch:()=>chromium.launch({headless:true}),...options}); }
  assertOwner(id,owner) {
    const s=this.get(id);
    if(!owner||s.owner!==owner)throw Object.assign(Error('このログイン画面は別の利用者のものです'),{status:403});
    return s;
  }
  async startOwned(options,owner){
    if(!owner)throw Error('利用者認証が必要です');
    // super.start reserves the single session synchronously before its first await.
    const pending=this.start({...options,remote:true});
    const s=this.session;
    if(s&&!s.owner)s.owner=owner;
    const result=await pending;
    return {...result,remote:true};
  }
  async operate(id,owner,input){
    const s=this.assertOwner(id,owner);
    if(s.phase!=='waiting')throw Error('ログイン操作は終了または確認中です');
    if(s.operating)throw Object.assign(Error('操作中です。少し待ってください'),{status:409});
    s.operating=true;
    try{
      const p=s.page;
      if(input.type==='frame')return {image:(await p.screenshot({type:'jpeg',quality:75,timeout:5000})).toString('base64'),width:1100,height:760};
      if(input.type==='click'){
        if(!Number.isFinite(input.x)||!Number.isFinite(input.y)||input.x<0||input.y<0||input.x>=1100||input.y>=760)throw Error('操作位置が不正です');
        await p.mouse.click(input.x,input.y);
      }else if(input.type==='text'){
        if(typeof input.text!=='string'||input.text.length>2048)throw Error('入力は2048文字までです');
        await p.keyboard.insertText(input.text);
      }else if(input.type==='key'){
        if(!['Tab','Shift+Tab','Enter','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Control+A','Escape','Space'].includes(input.key))throw Error('対応していないキーです');
        await p.keyboard.press(input.key);
      }else if(input.type==='scroll'){
        if(!Number.isFinite(input.y)||Math.abs(input.y)>1000)throw Error('スクロール量が不正です');
        await p.mouse.wheel(0,input.y);
      }else throw Error('対応していない操作です');
      return {ok:true};
    } finally{s.operating=false;}
  }
}
