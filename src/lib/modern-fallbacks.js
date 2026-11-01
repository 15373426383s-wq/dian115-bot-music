// Additional public web protocols, used only when the upstream music-dl endpoint fails.
// Protocol references (no copied implementation):
// https://github.com/chongya369/qqmusic-api-py/blob/main/docs/API调用说明.md
// https://github.com/keyule/KuGou-API
import {json,request,probe,mediaURL,urlWith} from './network.js';
import {qqUserId} from './credentials.js';
export async function qqWebResolve(ctx,s,item,variants){
 const uin=qqUserId(s);
 const guid=String(1000000000+Math.floor(Math.random()*9000000000));let last;
 for(const v of variants){try{
   const filename=v.prefix+(item.mediaMid||item.mid)+'.'+v.ext;
   const data={comm:{ct:24,cv:0,uin:Number(uin),format:'json'},req_0:{module:'vkey.GetVkeyServer',method:'CgiGetVkey',param:{guid,songmid:[item.mid],songtype:[0],uin,loginflag:uin==='0'?0:1,platform:'20',filename:[filename]}}};
   const r=await json(ctx,s,'qq','https://u.y.qq.com/cgi-bin/musicu.fcg',{method:'POST',json:data,headers:{Referer:'https://y.qq.com/','Content-Type':'application/json'}});
   const payload=r.req_0;if(!payload||payload.code!==0)throw new Error('QQ 音乐网页播放接口：'+String(payload?.code??r.code??'响应无效'));
   const purl=payload.data?.midurlinfo?.[0]?.purl;if(!purl)continue;
   const url=mediaURL(new URL(purl,payload.data.sip?.[0]||'https://dl.stream.qqmusic.qq.com/').href);
   return{...item,...v,...await probe(ctx,s,'qq',url)};
 }catch(e){last=e;}}
 throw last||new Error('QQ 音乐网页接口未提供公开播放地址，可能需要对应会员或登录');
}
export async function kugouWebResolve(ctx,s,item,variants){let last;for(const v of variants){try{
 const r=await request(ctx,s,'kugou',urlWith('https://wwwapi.kugou.com/yy/index.php',{r:'play/getdata',callback:'dianmusic',mid:'1',hash:v.hash,album_id:item.albumId||'',platid:4}),{headers:{Referer:'https://www.kugou.com/'}});
 let body=String(r.body||'').trim();if(body.startsWith('dianmusic(')){const match=body.match(/^dianmusic\(([\s\S]*)\);?$/);if(!match)throw new Error('酷狗网页接口返回了无效 JSONP');body=match[1];}
 let data;try{data=JSON.parse(body);}catch{throw new Error('酷狗网页接口没有返回 JSON');}
 const a=data.data;if(!a?.play_url)throw new Error('酷狗网页接口未提供公开播放地址'+(data.err_code?'：'+data.err_code:''));
 const bitrate=Number(a.bitrate||v.bitrate);return{...item,...v,url:mediaURL(a.play_url),ext:new URL(a.play_url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]||v.ext||'mp3',cover:a.img||item.cover,bitrate:bitrate>10000?bitrate/1000:bitrate,size:Number(a.filesize||0)/1048576||item.size};
 }catch(e){last=e;}}throw last||new Error('酷狗网页音频地址暂不可用');}
