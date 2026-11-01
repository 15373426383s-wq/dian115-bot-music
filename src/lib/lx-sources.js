import {LXRuntime,LX_CODES,sourceMetadata,sourceSummary,publicLXURL} from './lx-runtime.js';
import {BUILTIN_CATALOGS,searchAction,canSearch,isScriptSong,advertisedQualityOrder,qualityRank} from './source-registry.js';
import {normalizeSong,settingsOf,errorText,text} from './model.js';
import {PROVIDERS,lyrics as nativeLyrics} from './providers.js';
import {probe} from './network.js';
const runtimes=new WeakMap();
export function lxMusicInfo(item){
 const hashes=Object.fromEntries((item.variants||[]).filter(v=>v.hash).map(v=>[v.lxType||(v.ext==='flac'?'flac':v.bitrate>=320?'320k':'128k'),v.hash]));
 const types=(item.variants||[]).map(v=>({type:v.lxType||(v.ext==='flac'?'flac':v.bitrate>=320?'320k':'128k'),size:v.size?Math.round(v.size*1048576):null,hash:v.hash||undefined}));
 const base={lrc:null,otherSource:null,typeUrl:{},source:LX_CODES[item.source],name:item.title,singer:item.artist,albumName:item.album,interval:`${Math.floor(item.duration/60)}:${String(Math.floor(item.duration%60)).padStart(2,'0')}`,duration:item.duration,img:item.cover,types,_types:Object.fromEntries(types.map(t=>[t.type,t]))};
 if(item.source==='qq')return{...base,songId:Number(item.id)||item.id,songmid:item.mid,strMediaMid:item.mediaMid||item.mid,albumId:item.albumMid||item.albumId||'',albumMid:item.albumMid||''};
 if(item.source==='netease')return{...base,songmid:Number(item.id)||item.id,songId:Number(item.id)||item.id,albumId:item.albumId||''};
 if(item.source==='kugou')return{...base,songmid:item.audioId||item.id,albumAudioId:item.albumAudioId||'',_interval:item.duration,hash:item.hash||item.id,songId:item.id,albumId:item.albumId||'',...hashes};
 if(item.source==='migu')return{...base,songmid:item.songmid||item.contentId||item.id,songId:item.songmid||item.id,copyrightId:item.copyrightId||'',contentId:item.contentId||item.id};
 return{...base,songmid:item.id,songId:item.id,albumId:item.albumId||''};
}
export const qualityOrder=advertisedQualityOrder;
async function recordOf(ctx,id,unverified=false){
 if(!/^[a-f0-9]{32,64}$/.test(String(id)))throw Error('请选择已导入的自定义音源');
 const record=await ctx.storage.get('lx:source:'+id);if(!record?.raw||!record?.code||record.raw.length>512*1024||record.code.length>3*1024*1024)throw Error('音源不存在或内容过大，请重新导入');
 if(unverified){record.hash=ctx.crypto.sha256(record.raw);record.compiledHash=ctx.crypto.sha256(record.code);}
 if(ctx.crypto.sha256(record.raw)!==record.hash||ctx.crypto.sha256(record.code)!==record.compiledHash)throw Error('音源校验失败，请重新导入');record.metadata=sourceMetadata(record.raw);return record;
}
async function runtimeOf(ctx,s,id){let map=runtimes.get(ctx);if(!map){map=new Map();runtimes.set(ctx,map);}if(map.has(id))return map.get(id);const record=await recordOf(ctx,id),runtime=new LXRuntime(ctx,record,s);map.set(id,runtime);await runtime.init();return runtime;}
export async function closeLX(ctx){const map=runtimes.get(ctx);if(!map)return;runtimes.delete(ctx);await Promise.allSettled(Array.from(map.values(),r=>r.close()));}
async function saveSummary(ctx,record){record.registryVersion=2;const summary={...sourceSummary(record),registryVersion:2,processing:record.processing||[]};await ctx.storage.set('lx:source:'+record.id,record);const index=await ctx.storage.get('lx:index')||[];await ctx.storage.set('lx:index',[summary,...index.filter(x=>x.id!==record.id)].slice(0,8));return summary;}
export async function sourceCatalogs(ctx,s,id=s.lxSourceId){const runtime=await runtimeOf(ctx,s,id);return{...sourceSummary({...runtime.record,sources:runtime.inited}),registryVersion:2,entries:Object.entries(runtime.inited).map(([key,entry])=>({key,...entry,searchable:canSearch(entry,key)}))};}
function fromScript(ctx,runtime,key,raw,builtinSource=''){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('搜索列表含无效歌曲');
 const id=raw.id??raw.songmid??raw.songId??raw.hash??raw.rid??raw.mid??raw.vid??ctx.crypto.sha256(JSON.stringify(raw));
 const names=value=>Array.isArray(value)?value.map(x=>typeof x==='string'?x:x?.name||'').filter(Boolean).join('、'):String(value||'');
 const interval=typeof raw.interval==='string'?raw.interval.split(':').reduce((n,v)=>n*60+(Number(v)||0),0):Number(raw.interval)||0;
 let cover=raw.img||raw.pic||raw.cover||'';if(cover){try{cover=publicLXURL(cover);}catch{cover='';}}
 const origin={kind:'script',scriptId:runtime.record.id,sourceKey:key,scriptHash:runtime.record.hash,scriptName:runtime.record.metadata.name,sourceName:runtime.inited[key].name,musicInfo:raw,...(builtinSource?{builtinSource}:{})};
 return normalizeSong({source:key,id:String(id),title:raw.name||raw.title,artist:names(raw.singer||raw.artist||raw.artists),album:raw.albumName||raw.album,duration:Number(raw.duration??raw._interval)||interval,cover,origin});
}
export async function searchSource(ctx,s,input={}){
 const runtime=await runtimeOf(ctx,s,input.id||s.lxSourceId),all=Object.keys(runtime.inited);
 const configured=s.lxCatalogs?.[runtime.record.id];const selected=Array.isArray(input.sources)&&input.sources.length?input.sources:Array.isArray(configured)?configured:all.filter(key=>canSearch(runtime.inited[key],key));
 if(!selected.length)throw Error('当前音源没有可搜索的曲库，请检查声明的搜索能力');
 if(selected.length>16)throw Error('每次最多搜索 16 个曲库，请缩小搜索范围');
 const items=[],sources=[];let truncated=false,total=0;const limit=Math.min(50,Math.max(1,Number(input.limit)||s.limit)),page=Math.max(1,Math.min(100,Number(input.page)||1));
 for(const key of [...new Set(selected)]){const entry=runtime.inited[key],at=Date.now();try{
  if(!entry)throw Error('音源没有声明此曲库');if(entry.type!=='music')throw Error('暂不支持这种曲库类型');let songs=[],partTotal=0,partTruncated=false;
  const action=searchAction({actions:entry.supportedActions});
  if(action){const result=await runtime.request({source:key,action,info:{keyword:String(input.query),page,limit}});const list=Array.isArray(result)?result:result?.list||result?.items;if(!Array.isArray(list))throw Error('搜索响应应包含歌曲列表');songs=list.slice(0,limit).map(raw=>fromScript(ctx,runtime,key,raw));partTotal=Number(result?.total)||songs.length;partTruncated=list.length>limit||result?.isEnd===false||partTotal>songs.length;}
  else if(BUILTIN_CATALOGS[key]&&entry.supportedActions.includes('musicUrl')){const native=BUILTIN_CATALOGS[key],list=await PROVIDERS[native].search(ctx,{...s,limit},String(input.query));songs=list.map(song=>({...fromScript(ctx,runtime,key,lxMusicInfo(song),native),size:song.size,bitrate:song.bitrate,ext:song.ext}));partTotal=songs.length;}
  else throw Error('此入口仅声明取链等能力，没有提供搜索或对应曲库适配器');
  items.push(...songs);total+=partTotal;truncated=truncated||partTruncated;sources.push({source:key,name:entry.name,scriptId:runtime.record.id,ok:true,count:songs.length,ms:Date.now()-at,mode:action?'script':'catalog'});
 }catch(e){sources.push({source:key,name:entry?.name||key,scriptId:runtime.record.id,ok:false,count:0,error:errorText(e),ms:Date.now()-at});if(runtime.broken)break;}}
 return{items,sources,total,truncated,at:Date.now(),page,scriptId:runtime.record.id};
}
async function route(ctx,s,item){
 const origin=item.origin;
 if(origin?.kind==='script'){if(!isScriptSong(item))throw Error('歌曲的音源来源信息无效，请重新搜索');const runtime=await runtimeOf(ctx,s,origin.scriptId);if(origin.scriptHash&&origin.scriptHash!==runtime.record.hash)throw Error('歌曲来源脚本已更新，请重新搜索后下载');if(!runtime.inited[origin.sourceKey])throw Error('原音源已不再声明此曲库');return{runtime,key:origin.sourceKey,musicInfo:origin.musicInfo};}
 const runtime=await runtimeOf(ctx,s,s.lxSourceId),key=LX_CODES[item.source];if(!key||!runtime.inited[key])throw Error('当前音源没有对应的曲库适配器，请从它自己的曲库搜索');return{runtime,key,musicInfo:lxMusicInfo(item)};
}
const extOf=(url,type,raw)=>{const path=new URL(url).pathname;const ext=/\.(mp3|flac|ape|m4a|aac|ogg|wav|wma|opus|webm|aiff|aif)$/i.exec(path)?.[1]?.toLowerCase();const hint=String(raw?.codec_type||raw?.ext||'').toLowerCase();return ext||(['mp3','flac','ape','m4a','aac','ogg','wav','wma','opus','webm','aiff','aif'].includes(hint)?hint:qualityRank(type)>=3?'flac':'mp3');};
export function mediaOptions(song){return isScriptSong(song)?{credentialSource:null,session:'script-media-'+song.origin.scriptId,validateURL:publicLXURL}:{};}
export async function resolveSong(ctx,s,song,options={}){
 const item=normalizeSong(song);if(item.origin?.kind!=='script'&&s.resolverMode!=='lx'){if(!PROVIDERS[item.source])throw Error('歌曲曲库不可用');return await PROVIDERS[item.source].resolve(ctx,s,item);}
 const {runtime,key,musicInfo}=await route(ctx,s,item),entry=runtime.inited[key];if(!entry.supportedActions.includes('musicUrl'))throw Error('此曲库没有声明播放地址能力');let last;
 for(const type of advertisedQualityOrder(s.quality,entry.qualitys)){try{
  let url=await runtime.resolve({source:key,action:'musicUrl',info:{type,musicInfo}}),ext=extOf(url,type,musicInfo),audio;
  const origin=item.origin||{kind:'script',scriptId:runtime.record.id,sourceKey:key,scriptHash:runtime.record.hash,scriptName:runtime.record.metadata.name,sourceName:entry.name,musicInfo,builtinSource:item.source};
  if(options.probe){audio=await probe(ctx,s,key,url,{...mediaOptions({origin}),inferFormat:true});url=audio.url;ext=audio.ext||extOf(url,type,musicInfo);}
  if(options.playable&&['ape','wma'].includes(ext))throw Error('浏览器不支持此音频格式，请更换音质或版本');
  return{...item,origin,url,ext,...(audio?.size?{size:audio.size}:{}),bitrate:type==='128k'?128:type==='320k'?320:0,lx:{sourceId:runtime.record.id,name:runtime.record.metadata.name,sourceKey:key,type}};
 }catch(e){if(runtime.broken)throw e;last=e;}}
 throw last||Error('当前音源没有提供可用地址');
}
export async function songLyrics(ctx,s,song){
 if(!isScriptSong(song)){if(s.resolverMode!=='lx')return await nativeLyrics(ctx,s,song);}
 const {runtime,key,musicInfo}=await route(ctx,s,song),entry=runtime.inited[key];
 if(entry.supportedActions.includes('lyric')){const result=await runtime.request({source:key,action:'lyric',info:{musicInfo}});if(typeof result==='string')return result;const value=result?.lyric??result?.lryic;if(typeof value!=='string')throw Error('音源歌词响应无效');return value;}
 if(song.origin?.builtinSource)return await nativeLyrics(ctx,s,{...song,source:song.origin.builtinSource});return'';
}
export async function songPicture(ctx,s,song){if(!isScriptSong(song))return song.cover||'';const {runtime,key,musicInfo}=await route(ctx,s,song);if(!runtime.inited[key].supportedActions.includes('pic'))return song.cover||'';const result=await runtime.request({source:key,action:'pic',info:{musicInfo}});return publicLXURL(result);}
export async function manageLX(ctx,s,input){
 if(input.action==='lx-list')return{items:await ctx.storage.get('lx:index')||[]};
 if(input.action==='lx-catalogs'||input.action==='lx-refresh'){const result=await sourceCatalogs(ctx,s,input.id);if(input.action==='lx-refresh'){const runtime=await runtimeOf(ctx,s,input.id);runtime.record.sources=runtime.inited;await saveSummary(ctx,runtime.record);}return result;}
 if(input.action==='lx-search')return await searchSource(ctx,s,input);
 if(input.action==='lx-fetch'){const runtime=new LXRuntime(ctx,{id:'import',metadata:{},raw:'',code:''},s);try{const response=await runtime.http(publicLXURL(input.url));if(response.statusCode!==200)throw Error('源脚本 HTTP '+response.statusCode);const raw=ctx.codec.utf8Decode(response.raw);if(!raw||/^\s*</.test(raw))throw Error('地址返回了网页，请使用脚本原始链接');return{raw};}finally{await runtime.close();}}
 if(input.action==='lx-install'){const index=await ctx.storage.get('lx:index')||[];if(index.length>=8&&!index.some(x=>x.id===input.id))throw Error('最多保存 8 份音源，请先移除一份');const record=await recordOf(ctx,input.id,true),runtime=new LXRuntime(ctx,record,s);try{record.sources=await runtime.init();record.createdAt=Date.now();return await saveSummary(ctx,record);}finally{await runtime.close();}}
 if(input.action==='lx-remove'){const index=await ctx.storage.get('lx:index')||[];if(!index.some(x=>x.id===input.id))throw Error('音源不存在');await ctx.storage.set('lx:index',index.filter(x=>x.id!==input.id));await ctx.storage.remove('lx:source:'+input.id);return{removed:true};}
 if(input.action==='lx-test'){const song=normalizeSong(input.song);if(!song.id)throw Error('请选择一个搜索结果测试取链');if(isScriptSong(song)&&song.origin.scriptId!==input.id)throw Error('这首歌属于其他音源，请先搜索所选音源自己的曲库');const result=await resolveSong(ctx,settingsOf({...s,resolverMode:'lx',lxSourceId:input.id,quality:input.quality||s.quality}),song,{probe:input.probe===true});return{source:result.lx.name,sourceKey:result.lx.sourceKey,type:result.lx.type,host:new URL(result.url).hostname,checkedAudio:input.probe===true,ok:true};}
 throw Error('未知音源操作');
}
