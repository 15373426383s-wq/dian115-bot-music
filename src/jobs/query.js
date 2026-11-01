import {SOURCES,settingsOf,mergeSongs,filterSongs,normalizeSong,errorText,trackKey} from '../lib/model.js';
import {PROVIDERS,sourceFromLink} from '../lib/providers.js';
import {manageLX,resolveSong,closeLX,searchSource,songLyrics,songPicture} from '../lib/lx-sources.js';
import {prepareListen} from '../lib/listen.js';
import {ptSites,ptDownloaders,ptSearch} from '../lib/pt.js';
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
 if(input.action==='pt-sites'){const sites=await ptSites(ctx);return{sites:sites.map(x=>({id:x.id,name:x.name,domain:x.domain,enabled:x.enabled!==false,searchEnabled:x.search_enabled!==false,downloader:x.downloader||'',priority:x.priority||0,lastError:x.last_error||''}))};}
 if(input.action==='pt-downloaders'){const list=await ptDownloaders(ctx);return{downloaders:list.map(x=>({name:x.name,type:x.type,isDefault:x.is_default===true,savePath:x.save_path||''}))};}
 const query=String(input.query||'').trim();if(!query||query.length>500)throw new Error('请输入 1–500 个字符的搜索内容或官方链接');
 if(input.action==='single'||input.action==='playlist'){
   const source=sourceFromLink(query,input.action);const r=await PROVIDERS[source][input.action](ctx,s,query);return{...r,items:filterSongs(mergeSongs(r.items,s.merge),input.filter),sources:[{source,count:r.items.length,ok:true}],at:Date.now()};
 }
 const selected=[...new Set(input.sources?.length?input.sources:s.sources)];
 const wantPt=selected.includes('pt');
 if(s.resolverMode==='lx'&&!wantPt){const r=await searchSource(ctx,s,{...input,query,id:input.scriptId||s.lxSourceId});return{...r,title:query,items:filterSongs(mergeSongs(r.items,s.merge),input.filter)};}
 const sources=selected.filter(id=>id!=='pt'&&SOURCES.some(x=>x.id===id&&!x.archived));
 if(!sources.length&&!wantPt)throw new Error('请至少选择一个音源');
 const [musicParts,ptResult]=await Promise.all([
  sources.length?Promise.all(sources.map(async source=>{const start=Date.now();try{const items=await PROVIDERS[source].search(ctx,s,query);return{source,items,ok:true,count:items.length,ms:Date.now()-start};}catch(e){return{source,items:[],count:0,ok:false,error:errorText(e),ms:Date.now()-start};}})):[],
  wantPt?ptSearch(ctx,{query,siteIds:Array.isArray(input.ptSiteIds)?input.ptSiteIds:[],page:input.page,pageSize:s.limit}).catch(e=>({items:[],parts:[{source:'pt',ok:false,count:0,error:errorText(e),ms:0}]})):{items:[],parts:[]}
 ]);
 const parts=[...musicParts,...ptResult.parts];
 return{title:query,items:filterSongs(mergeSongs([...musicParts.flatMap(x=>x.items),...ptResult.items],s.merge),input.filter),sources:parts,at:Date.now()};
}
export async function recover(){return{action:'resume'};}
