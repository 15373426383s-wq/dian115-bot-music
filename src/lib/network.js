import {errorText} from './model.js';
import {prepareCredentials,COOKIE_SITES} from './credentials.js';
export function mediaURL(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('音源返回了无效的媒体地址');const h=u.hostname.toLowerCase();if(h==='localhost'||h==='::1'||/^\[/.test(h)||/^(?:127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(h)||/(^|\.)(115\.com|115cdn\.com|115cdn\.net|115vod\.com|anxia\.com)$/.test(h))throw new Error('音源返回了不支持的媒体地址');return u.href;}
export function urlWith(base,params={}){const u=new URL(base);for(const[k,v]of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));return u.href;}
export async function request(ctx,settings,source,url,options={}){
 const {credentialSource=source,validateURL,...httpOptions}=options;
 const headers={'User-Agent':settings.resolverMode==='original'?'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1':'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/15.0 Mobile/15E148 Safari/604.1',...options.headers};
 if(COOKIE_SITES[credentialSource])await prepareCredentials(ctx,settings,credentialSource);
 let target=validateURL?validateURL(url):url;
 for(let hop=0;hop<6;hop++){
  const r=await ctx.http.request({url:target,session:`music-${source}`,timeout_seconds:15,max_bytes:options.save_to?0:8*1024*1024,...(settings.proxy?{proxy:settings.proxy}:{}),...httpOptions,...(validateURL?{follow_redirects:false}:{}),headers});
  if(validateURL&&[301,302,303,307,308].includes(r.status)){target=validateURL(new URL(header(r,'location'),target).href);continue;}
  if(r.status<200||r.status>=300)throw new Error(`${source} 接口 HTTP ${r.status}`);return r;
 }throw Error('音频地址重定向过多');
}
export async function json(ctx,settings,source,url,options={}){const r=await request(ctx,settings,source,url,options);let d=r.data;if(d===undefined){try{d=JSON.parse(r.body);}catch{throw new Error(`${source} 接口没有返回 JSON，可能已改版或需要验证`);}}if(!d||typeof d!=='object')throw new Error(`${source} 接口响应无效`);if((d.code&&Number(d.code)>=400)||d.error_code&&Number(d.error_code)!==22000)throw new Error(`${source}：${String(d.message||d.msg||d.error_message||d.code||d.error_code).slice(0,180)}`);return d;}
export function header(r,name){const v=Object.entries(r.headers||{}).find(([k])=>k.toLowerCase()===name.toLowerCase())?.[1];return Array.isArray(v)?v[0]:v||'';}
export async function probe(ctx,settings,source,url,options={}){
 const {credentialSource=source,session='music-'+source,validateURL=mediaURL}=options;
 if(COOKIE_SITES[credentialSource])await prepareCredentials(ctx,settings,credentialSource);
 let target=validateURL(url);
 for(let hop=0;hop<6;hop++){
  const r=await ctx.http.stream({url:target,method:'GET',session,follow_redirects:false,timeout_seconds:30,headers:DOWNLOAD_HEADERS,...(settings.proxy?{proxy:settings.proxy}:{})});
  try{
   if([301,302,303,307,308].includes(r.status)){target=validateURL(new URL(header(r,'location'),target).href);continue;}
   if(r.status<200||r.status>=300)throw new Error(`${source} 音频探测 HTTP ${r.status}`);
   const type=header(r,'content-type').toLowerCase();if(/text\/html|application\/json/.test(type))throw Error('音源返回了错误页，未获得可用音频');
   if(/mpegurl|dash\+xml/.test(type)||/\.(m3u8|mpd)(?:[?#]|$)/i.test(r.url||target))throw Error('此地址是分段播放清单，当前保存功能需要完整音频文件');
   const ext={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/flac':'flac','audio/x-flac':'flac','audio/aac':'aac','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/ogg':'ogg','application/ogg':'ogg','audio/wav':'wav','audio/x-wav':'wav','audio/x-ms-wma':'wma','audio/ape':'ape','audio/opus':'opus','audio/webm':'webm','video/webm':'webm','audio/aiff':'aiff','audio/x-aiff':'aiff'}[type.split(';')[0].trim()];
   if(type&&/^(image\/|text\/|application\/(?:zip|pdf))/.test(type))throw Error('音源响应不是音频');
   return{url:validateURL(r.url||target),size:Number(header(r,'content-length')||0)/1048576,contentType:type,...(options.inferFormat&&ext?{ext}:{})};
  }finally{await r.close();}
 }throw Error('音频地址重定向过多');
}
export const DOWNLOAD_HEADERS={'User-Agent':'Wget/1.19.5 (darwin17.5.0)',Accept:'*/*','Accept-Encoding':'identity'};
export const fault=errorText;
