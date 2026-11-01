import {SOURCES,settingsOf,mergeSongs,filterSongs,normalizeSong,errorText,trackKey} from '../lib/model.js';
import {PROVIDERS,sourceFromLink} from '../lib/providers.js';
import {manageLX,resolveSong,closeLX,searchSource,songLyrics,songPicture} from '../lib/lx-sources.js';
import {prepareListen} from '../lib/listen.js';
export async function run(ctx,input={}){try{return await query(ctx,input);}finally{await closeLX(ctx);}}
async function query(ctx,input={}){
 if(input.action==='capabilities')return{host_api:ctx.plugin?.host_api||'',version:ctx.plugin?.version||'',direct_download:true};
 const s=settingsOf(await ctx.settings.get());
 if(input.action==='listen')return await prepareListen(ctx,s,input.song,input.quality);
 if(String(input.action).startsWith('lx-'))return await manageLX(ctx,s,input);
 if(input.action==='resolve'){
   const item=normalizeSong(input.song);if(!item.id||(!item.origin&&s.resolverMode!=='lx'&&!PROVIDERS[item.source]))throw new Error('歌曲标识无效');s.quality=settingsOf({...s,quality:input.quality||s.quality}).quality;const resolved=await resolveSong(ctx,s,item);
   let lyric='',lyricError='';try{lyric=await songLyrics(ctx,s,resolved);}catch(e){lyricError=errorText(e);}
   return{song:resolved,lyrics:lyric,lyricError};
 }
 if(input.action==='lyrics')return{lyrics:await songLyrics(ctx,s,normalizeSong(input.song))};
 const query=String(input.query||'').trim();if(!query||query.length>500)throw new Error('请输入 1–500 个字符的搜索内容或官方链接');
 if(input.action==='single'||input.action==='playlist'){
   const source=sourceFromLink(query,input.action);const r=await PROVIDERS[source][input.action](ctx,s,query);return{...r,items:filterSongs(mergeSongs(r.items,s.merge),input.filter),sources:[{source,count:r.items.length,ok:true}],at:Date.now()};
 }
 if(s.resolverMode==='lx'){const r=await searchSource(ctx,s,{...input,query,id:input.scriptId||s.lxSourceId});return{...r,title:query,items:filterSongs(mergeSongs(r.items,s.merge),input.filter)};}
 const selected=input.sources?.length?input.sources:s.sources;
 if(!selected.length)throw new Error('请至少选择一个音源');
 const sources=[...new Set(selected)].filter(id=>SOURCES.some(x=>x.id===id&&!x.archived));if(!sources.length)throw new Error('没有有效的音源');
 const parts=await Promise.all(sources.map(async source=>{const start=Date.now();try{const items=await PROVIDERS[source].search(ctx,s,query);return{source,items,ok:true,count:items.length,ms:Date.now()-start};}catch(e){return{source,items:[],count:0,ok:false,error:errorText(e),ms:Date.now()-start};}}));
 return{title:query,items:filterSongs(mergeSongs(parts.flatMap(x=>x.items),s.merge),input.filter),sources:parts.map(({items,...rest})=>rest),at:Date.now()};
}
export async function recover(){return{action:'resume'};}
