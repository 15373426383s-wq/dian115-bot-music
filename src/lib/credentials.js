export const COOKIE_SITES={
 netease:{url:'https://music.163.com/',domains:['music.163.com'],hosts:['music.163.com']},
 qq:{url:'https://y.qq.com/',domains:['qq.com'],hosts:['qq.com','y.qq.com','c.y.qq.com','u.y.qq.com','dl.stream.qqmusic.qq.com']},
 kugou:{url:'https://www.kugou.com/',domains:['kugou.com'],hosts:['kugou.com']},
 migu:{url:'https://music.migu.cn/',domains:['migu.cn'],hosts:['migu.cn']}
};
function site(source){const value=COOKIE_SITES[source];if(!value)throw new Error('该音源已移除');return value;}
export function cookieHeader(value){
 const input=String(value||'').trim().replace(/^cookie\s*:\s*/i,'');
 if(!input)return'';
 if(input.length>32768||/[\x00-\x1f\x7f]/.test(input))throw new Error('CK 请填写一行 Cookie 请求头，最多 32 KiB');
 const parts=input.split(';').map(x=>x.trim()).filter(Boolean);
 if(parts.some(x=>!/^[-!#$%&'*+.^_`|~\w]+=/.test(x)))throw new Error('CK 格式应为 name=value; name2=value2');
 return parts.join('; ');
}
export function scopedCookies(source,values,now=Date.now()){
 const target=site(source),result=[],seen=new Set();
 for(const value of Array.isArray(values)?values:[]){
  const domain=String(value.domain||'').replace(/^\./,'').toLowerCase(),path=String(value.path||'/');
  const allowed=source==='qq'?target.hosts.some(h=>domain===h||h!=='qq.com'&&domain.endsWith('.'+h)):target.domains.some(h=>domain===h||domain.endsWith('.'+h));
  if(!allowed||!/^[-!#$%&'*+.^_`|~\w]+$/.test(value.name||'')||typeof value.value!=='string'||/[\r\n\0;]/.test(value.value)||!path.startsWith('/'))continue;
  if(Number(value.expires_at)>0&&Number(value.expires_at)*1000<=now)continue;
  const key=domain+'\0'+path+'\0'+value.name;if(seen.has(key))continue;seen.add(key);
  result.push({...value,domain:domain,path,name:value.name,value:value.value,host_only:value.host_only===true,secure:value.secure===true,http_only:value.http_only===true});
 }
 return result;
}
export function headerFromCookies(values){const map=new Map();for(const c of values)if(!map.has(c.name))map.set(c.name,c.value);return[...map].map(([name,value])=>name+'='+value).join('; ');}
export function cookieValue(settings,source,name){const part=cookieHeader(settings.cookies?.[source]).split('; ').find(x=>x.startsWith(name+'='));return part?part.slice(name.length+1):'';}
export function qqUserId(settings){return(cookieValue(settings,'qq','uin')||cookieValue(settings,'qq','qqmusic_uin')||cookieValue(settings,'qq','wxuin')).replace(/^o/,'').match(/^\d+$/)?.[0]||'0';}
export async function readCredentials(ctx,source,from='cookiecloud'){
 const target=site(source);let values;
 if(from==='cookiecloud'){const snapshot=await ctx.cookiecloud('read',{domains:target.domains});values=snapshot?.cookies;}
 else if(from==='session')values=await ctx.http.cookies({url:target.url,session:'music-'+source});
 else throw new Error('未知的 CK 来源');
 const records=scopedCookies(source,values);if(!records.length)throw new Error(from==='cookiecloud'?'CookieCloud 中没有该音乐站点的有效 CK，请先同步或手动填写。':'本插件会话中没有该站点的有效 CK。');
 return{records,header:headerFromCookies(records),count:records.length};
}
const prepared=new WeakMap();
export async function prepareCredentials(ctx,settings,source){
 const target=site(source),header=cookieHeader(settings.cookies?.[source]);
 const original=Array.isArray(settings.cookieRecords?.[source])?settings.cookieRecords[source]:[];
 const imported=original.length>0&&headerFromCookies(original)===header,records=scopedCookies(source,original);
 const signature=JSON.stringify([header,records]);let state=prepared.get(ctx);if(!state){state=new Map();prepared.set(ctx,state);}
 if(state.get(source)?.signature===signature)return await state.get(source).promise;
 const promise=(async()=>{
  await ctx.http.importCookies({session:'music-'+source,replace:true,cookies:imported?records:[]});
  if(header&&!imported){
   const domain=source==='qq'?'qq.com':target.domains[0];
   const cookies=header.split('; ').map(part=>{const split=part.indexOf('=');return{domain,path:'/',name:part.slice(0,split),value:part.slice(split+1),host_only:false,secure:true,http_only:true};});
   await ctx.http.importCookies({session:'music-'+source,cookies});
  }
 })();state.set(source,{signature,promise});try{await promise;}catch(e){state.delete(source);throw e;}
}
