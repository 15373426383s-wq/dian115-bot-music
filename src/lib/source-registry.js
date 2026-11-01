// Built-in catalog adapters are optional; script entry keys are never a whitelist.
export const BUILTIN_CATALOGS={wy:'netease',tx:'qq',kg:'kugou',kw:'kuwo',mg:'migu'};
export const SOURCE_ACTIONS=['musicSearch','search','musicUrl','lyric','pic'];
const unsafe=new Set(['__proto__','prototype','constructor']);
export function validSourceKey(key){return typeof key==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(key)&&!unsafe.has(key);}
export function searchAction(entry){return entry?.actions?.includes('musicSearch')?'musicSearch':entry?.actions?.includes('search')?'search':'';}
export function canSearch(entry,key){const actions=entry?.supportedActions||entry?.actions;return (entry?.type||'music')==='music'&&!!(searchAction({actions})||BUILTIN_CATALOGS[key]&&actions?.includes('musicUrl'));}
export function declaredSources(info){
 if(!info?.sources||typeof info.sources!=='object'||Array.isArray(info.sources))throw Error('音源没有提供曲库声明');
 const entries=Object.entries(info.sources);if(!entries.length||entries.length>32)throw Error('音源应声明 1–32 个曲库入口');
 const out=Object.create(null);
 for(const [key,value] of entries){
  if(!validSourceKey(key)||!value||typeof value!=='object')throw Error('曲库标识或声明无效');
  const actions=[...new Set(Array.isArray(value.actions)?value.actions.filter(x=>typeof x==='string'&&/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(x)):[])].slice(0,20);
  const qualitys=[...new Set(Array.isArray(value.qualitys)?value.qualitys.filter(x=>typeof x==='string'&&/^[a-zA-Z0-9_.-]{1,40}$/.test(x)):[])].slice(0,32);
  const type=String(value.type||'music').slice(0,40),supported=type==='music'?actions.filter(x=>SOURCE_ACTIONS.includes(x)):[];
  out[key]={name:String(value.name||key).replace(/<[^>]*>/g,'').slice(0,80),type,actions,qualitys,supportedActions:supported,unsupportedActions:actions.filter(x=>!supported.includes(x)),searchMode:searchAction({actions:supported})?'script':BUILTIN_CATALOGS[key]&&supported.includes('musicUrl')?'catalog':'unavailable'};
 }
 return out;
}
export function sourceName(song,names={}){return song?.origin?.sourceName||names[song?.source]||song?.source||'未知曲库';}
export function isScriptSong(song){return song?.origin?.kind==='script'&&typeof song.origin.scriptId==='string'&&validSourceKey(song.origin.sourceKey);}
export function qualityRank(value){const q=String(value).toLowerCase();if(/24|hi.?res/.test(q))return 4;if(/flac|lossless|ape|master/.test(q))return 3;if(/320|high|exhigh/.test(q))return 2;if(/192/.test(q))return 1.5;if(/128|low|standard/.test(q))return 1;return 0;}
export function advertisedQualityOrder(quality,values){
 if(!values?.length)return[null];const sorted=values.map((value,index)=>({value,index,rank:qualityRank(value)}));
 sorted.sort((a,b)=>{if(quality==='standard')return(a.rank||5)-(b.rank||5)||a.index-b.index;if(quality==='high'){const order=r=>r===2?0:r===1.5?1:r===1?2:r===3?3:r===4?4:5;return order(a.rank)-order(b.rank)||a.index-b.index;}return b.rank-a.rank||a.index-b.index;});return sorted.map(x=>x.value);
}
