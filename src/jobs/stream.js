import {listenLease} from '../lib/listen.js';
import {settingsOf,errorText} from '../lib/model.js';
import {publicLXURL} from '../lib/lx-runtime.js';
import {header,DOWNLOAD_HEADERS} from '../lib/network.js';
import {prepareCredentials,COOKIE_SITES} from '../lib/credentials.js';
const MIME={mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',ogg:'audio/ogg',opus:'audio/opus',wav:'audio/wav',webm:'audio/webm',aiff:'audio/aiff'};
const fault=(status,message,headers={})=>({status,headers:{'Cache-Control':'no-store',...headers},json:{error:message}});
export function validRange(value){
 if(!value)return true;const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||!m[1]&&!m[2])return false;
 if([m[1],m[2]].some(x=>x&&!Number.isSafeInteger(Number(x))))return false;
 return m[1]?(!m[2]||Number(m[1])<=Number(m[2])):Number(m[2])>0;
}
export async function handle(ctx,req){
 const match=/^\/?listen\/([a-f0-9]{64})$/.exec(req.path||'');
 if(!match)return fault(404,'播放入口不存在');
 if(!['GET','HEAD'].includes(req.method))return fault(405,'只支持音频读取',{Allow:'GET, HEAD'});
 const range=header(req,'range');if(!validRange(range))return fault(416,'播放范围无效');
 const lease=await listenLease(ctx,match[1]);if(!lease)return fault(410,'播放地址已过期，请重新点击歌曲');
 const s=settingsOf(await ctx.settings.get());
 if(!lease.scriptId&&COOKIE_SITES[lease.source])await prepareCredentials(ctx,s,lease.source);
 const headers={...DOWNLOAD_HEADERS,...(range?{Range:range}:{})},ifRange=header(req,'if-range');
 if(ifRange&&ifRange.length<256&&!/[\r\n]/.test(ifRange))headers['If-Range']=ifRange;
 let upstream,started=false,target=publicLXURL(lease.url);
 try{
  for(let hop=0;hop<6;hop++){
   upstream=await ctx.http.stream({url:target,method:'GET',session:lease.scriptId?'script-media-'+lease.scriptId:'music-'+lease.source,headers,follow_redirects:false,timeout_seconds:30,...(s.proxy?{proxy:s.proxy}:{})});
   if([301,302,303,307,308].includes(upstream.status)){
    const location=header(upstream,'location');await upstream.close();upstream=null;target=publicLXURL(new URL(location,target).href);continue;
   }
   if(upstream.status===416)return fault(416,'上游不接受该播放范围',/^bytes \*\/\d+$/.test(header(upstream,'content-range'))?{'Content-Range':header(upstream,'content-range')}:{});
   if(![200,206].includes(upstream.status))return fault(502,'音频服务 HTTP '+upstream.status);
   publicLXURL(upstream.url||target);
   const type=header(upstream,'content-type').toLowerCase();
   if(/^(text\/|image\/)|json|mpegurl|dash\+xml|application\/(zip|pdf)/.test(type)||/\.(m3u8|mpd)(?:[?#]|$)/i.test(target))return fault(502,'音源未返回可播放的完整音频');
   const output={'Content-Type':type||MIME[lease.ext]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
   for(const name of ['Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified']){const value=header(upstream,name);if(value&&!/[\r\n]/.test(value))output[name]=value;}
   if(req.method==='HEAD')return{status:upstream.status,headers:output,body:''};
   const stream=await ctx.response.stream({status:upstream.status,headers:output});started=true;
   for(;;){const chunk=await upstream.read();if(chunk===null)break;await stream.write(chunk);}
   return;
  }
  return fault(502,'音频地址重定向过多');
 }catch(e){if(started)throw Error('在线音频连接中断');return fault(502,errorText(e));}
 finally{if(upstream)await upstream.close();}
}
