import {declaredSources,SOURCE_ACTIONS} from './source-registry.js';
import {Interpreter,Unzlib,zlibSync} from './lx-engine.js';
import {PRELUDE} from './lx-prelude.js';
import {mediaURL,header} from './network.js';
import {lxRawRSA} from './netease-crypto.js';
export const LX_CODES={netease:'wy',qq:'tx',kugou:'kg',migu:'mg',kuwo:'kw'};
export const LX_QUALITIES=['128k','320k','flac','flac24bit'];
const BYTE_LIMIT=512*1024;
export function sourceMetadata(raw){const field=name=>String(raw.match(new RegExp('^\\s*\\*?\\s*@'+name+'\\s+(.+)$','m'))?.[1]||'').trim().slice(0,180);return{name:field('name')||'未命名自定义音源',description:field('description'),version:field('version'),author:field('author'),homepage:field('homepage')};}
export function sourceSummary(record){return{id:record.id,...record.metadata,hash:record.hash,sources:record.sources||{},createdAt:record.createdAt};}
export function publicLXURL(value){const u=new URL(mediaURL(value));const h=u.hostname.replace(/\.$/,'').toLowerCase();if(!h.includes('.')||/\.(local|localhost|internal|lan|home|test|invalid)$/.test(h)||/^(?:100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(?:1[89])\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(h))throw Error('音源脚本 不支持内网或保留地址');return u.href;}

export class LXRuntime{
 constructor(ctx,record,settings={},limits={}){
  this.ctx=ctx;this.record=record;this.settings=settings;this.limits={steps:4000000,milliseconds:180000,...limits};this.events=[];this.pending=new Set();this.timers=new Map();this.nextTimer=0;this.requests=0;this.inited=null;this.closed=false;
  const vm=this.vm=new Interpreter('',(interpreter,g)=>{
   const put=(key,fn)=>interpreter.setProperty(g,key,interpreter.createNativeFunction((...args)=>{try{return fn(...args);}catch(e){interpreter.throwException(interpreter.ERROR,String(e.message||'音源脚本 操作失败').slice(0,220));}}));
   const native=v=>interpreter.pseudoToNative(v),pseudo=v=>interpreter.nativeToPseudo(v);
   const bytes=v=>{v=typeof v==='string'?ctx.codec.utf8Encode(v):native(v);if(!Array.isArray(v)&&!(v instanceof Uint8Array))throw Error('音源脚本 需要字节数组');if(v.length>BYTE_LIMIT)throw Error('音源脚本 字节数据超过 512 KiB');return new Uint8Array(v);};
   const out=v=>{if(v.length>BYTE_LIMIT)throw Error('音源脚本 输出超过 512 KiB');return pseudo(Array.from(v));};
   const encode=(v,enc)=>{enc=String(enc||'utf8').toLowerCase().replace('-','');if(typeof v!=='string')return bytes(v);if(v.length>BYTE_LIMIT)throw Error('音源脚本 字符串过大');if(enc==='hex')return ctx.codec.hexDecode(v);if(enc==='base64')return ctx.codec.base64Decode(v);if(enc==='binary'||enc==='latin1'||enc==='ascii')return new Uint8Array(Array.from(v,c=>c.charCodeAt(0)&255));if(enc!=='utf8')throw Error('不支持的 音源脚本 字符编码');return ctx.codec.utf8Encode(v);};
   put('__lxBufferFrom',(v,enc)=>out(encode(v,enc)));
   put('__lxBufferString',(v,enc)=>{const b=typeof v==='string'?encode(v,'binary'):bytes(v);enc=String(enc||'utf8').toLowerCase().replace('-','');if(enc==='hex')return ctx.codec.hexEncode(b);if(enc==='base64')return ctx.codec.base64Encode(b);if(enc==='binary'||enc==='latin1'||enc==='ascii')return Array.from(b,n=>String.fromCharCode(n)).join('');if(enc!=='utf8')throw Error('不支持的 音源脚本 字符编码');return ctx.codec.utf8Decode(b);});
   put('__lxMD5',v=>ctx.crypto.md5(typeof v==='string'?v:bytes(v)));
   put('__lxRandom',n=>{if(!Number.isInteger(n)||n<0||n>65536)throw Error('随机字节数量超出范围');return out(ctx.crypto.randomBytes(n));});
   put('__lxAES',(b,mode,key,iv)=>{const m=String(mode).match(/^aes-(128|192|256)-(ecb|cbc)$/);if(!m)throw Error('音源脚本 AES 支持 ECB / CBC');const k=bytes(key);if(k.length*8!==Number(m[1]))throw Error('AES 密钥长度不匹配');return out(ctx.crypto.aesEncrypt({mode:m[2],key:k,data:bytes(b),...(m[2]==='cbc'?{iv:bytes(iv)}:{}),padding:'pkcs7',output:'bytes'}));});
   put('__lxRSA',(b,key)=>out(lxRawRSA(ctx,bytes(b),String(key))));
   put('__lxDeflate',b=>out(zlibSync(bytes(b))));
   put('__lxInflate',b=>{const chunks=[];let size=0;const unzip=new Unzlib(chunk=>{size+=chunk.length;if(size>BYTE_LIMIT)throw Error('音源脚本 解压数据超过 512 KiB');chunks.push(chunk);});const input=bytes(b);for(let i=0;i<input.length;i+=128)unzip.push(input.slice(i,i+128),i+128>=input.length);const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return out(result);});
   interpreter.setProperty(g,'__lxMetadata',pseudo({...record.metadata,rawScript:record.raw}));
   put('__lxSend',(event,data)=>{if(event==='updateAlert'){this.updateAlert=true;return;}if(event!=='inited')throw Error('不支持的 音源脚本 事件');if(this.inited)throw Error('音源脚本 已经初始化');this.inited=declaredSources(native(data));});
   put('__lxRequest',(url,options,callback)=>{if(this.closed||++this.requests>40||this.pending.size>=6)throw Error('音源脚本 请求数量超过限制');if(!callback?.class||callback.class!=='Function')throw Error('音源脚本 请求回调无效');let cancelled=false;const p=this.http(String(url),native(options)).then(r=>{if(!cancelled&&!this.closed)this.events.push({callback,args:[null,r,r.body]});},()=>{if(!cancelled&&!this.closed)this.events.push({callback,args:['音源脚本 HTTP 请求失败（网络、地址或响应大小限制）',null,null]});}).finally(()=>this.pending.delete(p));this.pending.add(p);return interpreter.createNativeFunction(()=>{cancelled=true;});});
   put('setTimeout',(fn,ms)=>this.timer(fn,ms,false));put('setInterval',(fn,ms)=>this.timer(fn,ms,true));put('clearTimeout',id=>this.timers.delete(id));put('clearInterval',id=>this.timers.delete(id));
   put('atob',s=>Array.from(ctx.codec.base64Decode(String(s)),n=>String.fromCharCode(n)).join(''));put('btoa',s=>{s=String(s);if(Array.from(s,c=>c.charCodeAt(0)).some(n=>n>255))throw Error('btoa 只接受 Latin-1 字符');return ctx.codec.base64Encode(encode(s,'binary'));});
  });
  // The host has no worker/Node VM for native regex timeouts. Permit a bounded
  // subset: no grouped repetition/backreferences/lookarounds or ambiguous repeats.
  vm.REGEXP_MODE=1;
  vm.maybeThrowRegExp=function(r){const s=r.source;const stripped=s.replace(/\\./g,'x').replace(/\[[^\]]*\]/g,'x');const parts=s.split('\\s*'),pairs={'\\(':'\\)','\\[':'\\]','\\{':'\\}'};const whitespaceFrame=parts.length===3&&pairs[parts[0]]===parts[2]&&/^[a-z0-9_-]{1,64}$/i.test(parts[1]);if(s.length>512||/\\[1-9]|\(\?(?!:)/.test(s)||/\)[*+{]/.test(stripped)||((stripped.match(/[*+{]/g)||[]).length>1&&!whitespaceFrame)||(stripped.replace(/\(\?:/g,'(').match(/\?/g)||[]).length>4)throw Error('音源脚本 正则表达式超出安全兼容范围');};
  for(const [proto,names] of [[vm.STRING_PROTO,['match','search','split','replace']],[vm.REGEXP_PROTO,['exec']]])for(const name of names){const func=proto?.properties?.[name];if(func?.asyncFunc){const original=func.asyncFunc;const wrapped=function(...args){if(args.some(x=>typeof x==='string'&&x.length>8192)||String(this).length>8192)throw Error('音源脚本 正则字符串最大 8192 字符');return original.apply(this,args);};Object.defineProperty(wrapped,'length',{value:original.length});func.asyncFunc=wrapped;}}
  const setProperty=vm.setProperty;vm.setProperty=function(object,name,value,...rest){if(typeof value==='string'&&value.length>3*1024*1024)throw Error('音源脚本 字符串超出内存限制');if(object?.class==='Array'&&((name==='length'&&value>524288)||/^\d+$/.test(String(name))&&Number(name)>524288))throw Error('音源脚本 数组超出内存限制');return setProperty.call(this,object,name,value,...rest);};
  const createObject=vm.createObjectProto;let objects=0;vm.createObjectProto=function(...args){if(++objects>60000)throw Error('音源脚本 对象数量超出内存限制');return createObject.apply(this,args);};
  this.steps=0;
 }
 timer(fn,ms,repeat){if(this.timers.size>=32||fn?.class!=='Function')throw Error('音源脚本 定时器超出范围');const id=++this.nextTimer;this.timers.set(id,{callback:fn,ms:Math.max(10,Math.min(45000,Number(ms)||0)),at:Date.now()+Math.max(10,Number(ms)||0),repeat});return id;}
 async http(url,options={}){
  url=publicLXURL(url);if(JSON.stringify(options).length>BYTE_LIMIT)throw Error('音源脚本 请求参数过大');let method=String(options.method||'GET').toUpperCase();if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method))throw Error('音源脚本 请求方法不支持');
  const headers={};for(const[k,v]of Object.entries(options.headers||{})){if(!/^[a-z0-9-]{1,80}$/i.test(k)||/[\r\n]/.test(String(v))||/^(host|connection|content-length|proxy-authorization)$/i.test(k))throw Error('音源脚本 请求头不支持');headers[k]=String(v);}
  if(options.formData)throw Error('音源脚本 formData 暂不支持；请使用 body 或 form');
  let body={};if(options.body!==undefined)body=typeof options.body==='string'?{body:options.body}:Array.isArray(options.body)?{body_base64:this.ctx.codec.base64Encode(options.body)}:{json:options.body};else if(options.form)body={form:options.form};
  for(let redirect=0;redirect<=5;redirect++){
   const r=await this.ctx.http.request({url,method,headers,...body,session:'lx-'+this.record.id,follow_redirects:false,response_type:'base64',timeout_seconds:Math.max(1,Math.min(60,Math.ceil((Number(options.timeout)||30000)/1000))),max_bytes:BYTE_LIMIT,...(this.settings.proxy?{proxy:this.settings.proxy}:{})});
   if([301,302,303,307,308].includes(r.status)){const target=publicLXURL(new URL(header(r,'location'),url).href);if(new URL(target).origin!==new URL(url).origin)for(const k of Object.keys(headers))if(/authorization|cookie|key|token/i.test(k))delete headers[k];if(r.status===303||[301,302].includes(r.status)&&method==='POST'){method='GET';body={};}url=target;continue;}
   const raw=r.body_base64?this.ctx.codec.base64Decode(r.body_base64):this.ctx.codec.utf8Encode(r.body||'');if(raw.length>BYTE_LIMIT)throw Error('音源脚本 响应过大');const text=this.ctx.codec.utf8Decode(raw);let parsed=text;try{parsed=JSON.parse(text);}catch{}
   return{statusCode:r.status,statusMessage:'',headers:Object.fromEntries(Object.entries(r.headers||{}).map(([k,v])=>[k.toLowerCase(),Array.isArray(v)?v.join(', '):v])),bytes:raw.length,raw:Array.from(raw),body:parsed};
  }throw Error('音源脚本 重定向过多');
 }
 get(key){return this.vm.getProperty(this.vm.globalObject,key);}
 async pump(code,ready){
  const started=Date.now(),stepStart=this.steps;this.vm.appendCode(code);
  try{for(;;){
   if(this.steps-stepStart>this.limits.steps||Date.now()-started>this.limits.milliseconds||this.vm.stateStack.length>600)throw Error('音源脚本 脚本执行超时或超出指令限制');
   let busy=this.vm.step();this.steps++;
   if(this.steps%1500===0)await this.ctx.sleep(1);
   if(busy)continue;
   if(this.events.length){const event=this.events.shift();this.vm.setProperty(this.vm.globalObject,'__lxCallback',event.callback);this.vm.setProperty(this.vm.globalObject,'__lxArgs',this.vm.nativeToPseudo(event.args));this.vm.appendCode('__lxCallback.apply(undefined,__lxArgs);');continue;}
   if(this.vm.getProperty(this.get('__lxJobs'),'length')){this.vm.appendCode('__lxFlush();');continue;}
   if(ready())return;
   const due=Array.from(this.timers.entries()).find(([,t])=>t.at<=Date.now());if(due){const[id,t]=due;if(t.repeat)t.at=Date.now()+t.ms;else this.timers.delete(id);this.events.push({callback:t.callback,args:[]});continue;}
   if(!this.pending.size&&!this.timers.size)throw Error('音源脚本 脚本没有完成初始化或没有返回播放地址');
   await this.ctx.sleep(5);
  }}catch(e){this.broken=true;throw new Error('音源脚本：'+String(e.message||'脚本执行失败').split('\n')[0].slice(0,250));}
 }
 async init(){await this.pump(PRELUDE+'\n'+this.record.code,()=>!!this.inited);if(!this.get('__lxHandler'))throw Error('自定义音源没有注册 request 处理器');return this.inited;}
 async request(input){
  const entry=this.inited?.[input?.source];if(!entry)throw Error('音源没有声明这个曲库入口');if(!SOURCE_ACTIONS.includes(input.action)||!entry.supportedActions.includes(input.action))throw Error('此曲库未提供 '+String(input.action)+' 能力');
  this.requests=0;this.vm.setProperty(this.vm.globalObject,'__lxInput',this.vm.nativeToPseudo(input));
  await this.pump('__lxFinished=false;__lxFailure="";__lxResult=undefined;try{Promise.resolve(__lxHandler(__lxInput)).then(__lxResolve,__lxReject);}catch(e){__lxReject(e);}',()=>this.get('__lxFinished'));
  const error=this.get('__lxFailure');if(error)throw Error('音源请求失败：'+String(error).slice(0,500));
  const value=this.vm.pseudoToNative(this.get('__lxResult'));let json;try{json=JSON.stringify(value);}catch{throw Error('音源返回了无法保存的数据');}if(json&&json.length>512*1024)throw Error('音源返回数据超过 512 KiB');return json===undefined?null:JSON.parse(json);
 }
 async resolve(input){const result=await this.request({...input,action:'musicUrl'});if(typeof result!=='string'||result.length>2048)throw Error('musicUrl 必须返回 HTTP(S) 字符串地址');return publicLXURL(result);}

 async close(){this.closed=true;this.timers.clear();await Promise.allSettled(Array.from(this.pending));this.events=[];}
}
