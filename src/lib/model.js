import {validSourceKey} from './source-registry.js';
export const SOURCES=[
 {id:'netease',name:'网易云音乐',short:'网易云',color:'#e54b5c',hint:'搜索 · 单曲 · 歌单 · 歌词 · 免费模式可用(≤320)'},
 {id:'qq',name:'QQ 音乐',short:'QQ',color:'#15966b',hint:'搜索 · 多音质解析 · 歌词 · 高音质需登录'},
 {id:'kugou',name:'酷狗音乐',short:'酷狗',color:'#2c83cd',hint:'搜索 · 歌单 · 歌词 · 免费模式可用'},
 {id:'migu',name:'咪咕音乐',short:'咪咕',color:'#b64dab',hint:'无损优先 · 公开免费接口已失效，暂不可用'},
 {id:'kuwo',name:'酷我音乐',short:'酷我',color:'#b77d16',hint:'自定义扩展 · 需导入支持酷我的音源',lxOnly:true}
];
// Sources that return playable audio WITHOUT any account cookie. NetEase and
// Kugou public endpoints serve up to 320 kbps with no login; QQ requires a
// cookie for high quality and Migu's free endpoint is currently dead, so both
// are excluded from 免费模式.
export const FREE_SOURCES=['netease','kugou'];
export const DEFAULT_SETTINGS={sources:['netease','qq','kugou','migu'],resolverMode:'original',lxSourceId:'',lxCatalogs:{},limit:20,quality:'best',freeMode:true,merge:true,lyrics:true,cover:true,autoPlay:false,destination:'',proxy:'',cookies:{},cookieRecords:{},downloadTimeout:3600,maxDownloadMB:0,theme:'system',reduceTransparency:false};
export const SOURCE_NAME=Object.fromEntries(SOURCES.map(s=>[s.id,s.short]));
export const cloneData=value=>JSON.parse(JSON.stringify(value));
// Business IDs are not credentials; insecure HTTP hosts may lack randomUUID.
export function businessId(random=globalThis.crypto){return random?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);}
export const QUALITY_LABEL={best:'最佳可用',lossless:'无损优先',high:'320 kbps 优先',standard:'128 kbps 优先'};
export function settingsOf(value){const v={...DEFAULT_SETTINGS,...value};v.sources=[...new Set((Array.isArray(v.sources)?v.sources:DEFAULT_SETTINGS.sources).filter(x=>SOURCES.some(s=>s.id===x&&!s.archived)))];if(Array.isArray(value?.sources)&&value.sources.length&&!v.sources.length)v.sources=[...DEFAULT_SETTINGS.sources];if(!['original','compat','lx'].includes(v.resolverMode))v.resolverMode='original';v.lxSourceId=typeof v.lxSourceId==='string'?v.lxSourceId:'';v.lxCatalogs=Object.fromEntries(Object.entries(v.lxCatalogs&&typeof v.lxCatalogs==='object'?v.lxCatalogs:{}).filter(([id,keys])=>/^[a-f0-9]{32,64}$/.test(id)&&Array.isArray(keys)).map(([id,keys])=>[id,[...new Set(keys.filter(validSourceKey))].slice(0,16)]));v.limit=Math.min(50,Math.max(1,Math.floor(Number(v.limit))||20));if(!Object.prototype.hasOwnProperty.call(QUALITY_LABEL,v.quality))v.quality='best';
 // 免费模式（默认开启）：不依赖任何账号 Cookie 即可下载。原生音源下把音质上限
 // 压到 320 kbps（无损/会员音质需登录），并只保留经实测可免登录取链的音源
 // （网易云、酷狗）。关闭后可凭 Cookie 获取无损。自定义脚本(lx)自行管理鉴权。
 v.freeMode=v.freeMode!==false;
 if(v.freeMode&&v.resolverMode!=='lx'){
  const free=v.sources.filter(id=>FREE_SOURCES.includes(id));
  v.sources=free.length?free:[...FREE_SOURCES];
  if(v.quality==='best'||v.quality==='lossless')v.quality='high';
 }
 if(!['light','dark','system'].includes(v.theme))v.theme='system';v.destination=typeof v.destination==='string'?v.destination.trim():'';v.proxy=typeof v.proxy==='string'?v.proxy.trim():'';v.cookies=Object.fromEntries(SOURCES.map(s=>[s.id,typeof v.cookies?.[s.id]==='string'?v.cookies[s.id]:'']));v.cookieRecords=Object.fromEntries(SOURCES.map(s=>[s.id,Array.isArray(v.cookieRecords?.[s.id])?v.cookieRecords[s.id]:[]]));v.downloadTimeout=Math.max(60,Math.min(86400,Math.floor(Number(v.downloadTimeout))||3600));v.maxDownloadMB=Math.max(0,Math.min(1048576,Math.floor(Number(v.maxDownloadMB))||0));return v;}
export function errorText(e){return String(e?.data?.error||e?.message||e||'操作失败').replace(/(?:Cookie|Authorization)\s*[:=][^\n]+/gi,'凭据已隐藏').replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1***@').replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi,'$1?…').slice(0,700);}
export function text(value){return String(value??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();}
export function safeName(value){const clean=text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/\.{2,}/g,'.').trim();let result='',bytes=0;for(const character of clean){const length=new TextEncoder().encode(character).length;if(bytes+length>180)break;result+=character;bytes+=length;}return result||'未知曲目';}
export function trackKey(song){return song.origin?.kind==='script'?`script:${JSON.stringify([song.origin.scriptId,song.origin.sourceKey,song.id||song.hash||song.mid])}`:`${song.source}:${song.id||song.hash||song.mid}`;}
export function normalizeSong(song){const item={id:'',source:'',title:'未知曲目',artist:'未知歌手',album:'',duration:0,size:0,bitrate:0,ext:'mp3',cover:'',lyricsUrl:'',...song};item.id=String(item.id||item.hash||item.mid||'');item.title=text(item.title)||'未知曲目';item.artist=text(item.artist)||'未知歌手';item.album=text(item.album);for(const k of ['duration','size','bitrate'])item[k]=Math.max(0,Number(item[k])||0);return item;}
export function mergeSongs(songs,merge=true){const list=songs.map(normalizeSong);if(!merge)return list;list.sort((a,b)=>b.artist.localeCompare(a.artist,'zh-CN')||b.title.localeCompare(a.title,'zh-CN')||b.size-a.size);const map=new Map();for(const item of list){const key=`${item.artist.toLocaleLowerCase()}\0${item.title.toLocaleLowerCase()}`;if(!map.has(key))map.set(key,{...item,alternatives:[]});else map.get(key).alternatives.push(item);}return [...map.values()];}
export function parseFilter(value){if(!String(value||'').trim())return[];return String(value).split(',').filter(s=>s.trim()).map(s=>{const m=s.trim().match(/^(size|length)\s*([<>=])\s*(\d+(?:\.\d+)?)$/);if(!m)throw new Error(`筛选格式无效：${s}。例如 size>8,length>180`);return{field:m[1]==='size'?'size':'duration',op:m[2],value:Number(m[3])};});}
export function filterSongs(songs,value){const rules=parseFilter(value);return songs.filter(song=>rules.every(r=>{const n=Number(song[r.field]);return !n||(r.op==='>'?n>r.value:r.op==='<'?n<r.value:Math.abs(n-r.value)<.01);}));}
export function timeLabel(seconds){const s=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
export function sizeLabel(mb){return mb?`${Number(mb).toFixed(1)} MB`:'—';}
export function qualityLabel(song){return ['flac','ape','wav'].includes(song.ext)||song.bitrate>=700?'无损':song.bitrate>=320?'HQ':song.bitrate?`${song.bitrate}k`:'音质待解析';}
export function parseLRC(value){const result=[];let offset=0;for(const row of String(value||'').split(/\r?\n/)){const off=row.match(/\[offset:([-\d]+)\]/i);if(off)offset=Number(off[1])/1000;}for(const row of String(value||'').split(/\r?\n/)){const matches=[...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];const line=row.replace(/\[[^\]]*\]/g,'').trim();for(const m of matches)if(line)result.push({time:Math.max(0,Number(m[1])*60+Number(m[2])+offset),text:line});}return result.sort((a,b)=>a.time-b.time);}
export function pickVariants(variants,quality='best'){const list=variants.filter(x=>x.url||x.hash||x.prefix).sort((a,b)=>(b.bitrate||b.size||0)-(a.bitrate||a.size||0));if(quality==='high')return[...list.filter(x=>(x.bitrate||0)<=320),...list.filter(x=>(x.bitrate||0)>320)];if(quality==='standard')return[...list.filter(x=>(x.bitrate||0)<=128),...list.filter(x=>(x.bitrate||0)>128).reverse()];return list;}
