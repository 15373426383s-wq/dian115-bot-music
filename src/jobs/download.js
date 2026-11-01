import {absoluteDirectory} from '../lib/directories.js';
import {settingsOf,normalizeSong,safeName,errorText} from '../lib/model.js';
import {resolveSong,closeLX,songLyrics,songPicture,mediaOptions} from '../lib/lx-sources.js';
import {PROVIDERS} from '../lib/providers.js';
import {request,mediaURL,header,DOWNLOAD_HEADERS} from '../lib/network.js';
import {run as manage,recover as recoverManage} from './manage.js';
const extensions=new Set(['mp3','flac','ape','m4a','aac','ogg','wav','wma','opus','webm','aiff','aif']);
const exists=async(ctx,path)=>await ctx.files.call({operation:'exists',path});
// Library writes are throttled: the full library array is rewritten at most every
// LIBRARY_FLUSH items (and force-flushed at the end). This turns the original
// O(n^2) per-item get+set into roughly O(n/FLUSH) storage writes for a batch,
// while keeping catalog entries durable to within the last few completed items.
const LIBRARY_FLUSH=10;
const libCache=new WeakMap();
async function remember(ctx,record){
 let state=libCache.get(ctx);
 if(!state){state={items:await ctx.storage.get('library')||[],dirty:0};libCache.set(ctx,state);}
 state.items=[record,...state.items.filter(x=>x.path!==record.path)].slice(0,2000);
 state.dirty++;
 if(state.dirty>=LIBRARY_FLUSH){await ctx.storage.set('library',state.items);state.dirty=0;}
}
async function flushLibrary(ctx){
 const state=libCache.get(ctx);
 if(state&&state.dirty){await ctx.storage.set('library',state.items);state.dirty=0;}
}
async function matches(ctx,file){
 if(!await exists(ctx,file.path))return false;
 const stat=await ctx.files.call({operation:'stat',path:file.path});if(stat.is_dir||stat.size!==file.size)return false;
 return await ctx.files.call({operation:'hash',path:file.path,algorithm:'sha256'})===file.sha256;
}
export async function allocateStem(ctx,directory,song,ext,reserved=[]){
 const base=directory.replace(/\/$/,'')+'/'+safeName(`${song.artist} - ${song.title}`);
 for(let index=0;index<10000;index++){
  const stem=base+(index?` (${index})`:'');let taken=false;
  for(const suffix of new Set(['.'+ext,'.lrc','.jpg']))if(reserved.includes(stem+suffix)||await exists(ctx,stem+suffix)){taken=true;break;}
  if(!taken)return stem;
 }
 throw new Error('目录中的同名歌曲过多，请更换目录或整理文件');
}
function resultOf(cp){return{completed:cp.completed,failed:cp.failed};}
function finishError(cp){return new Error(`本批 ${cp.failed.length} 首歌曲均未保存：${cp.failed[0]?.error||'音源没有提供有效音频'}`);}
export async function run(ctx,input={}){try{return await download(ctx,input);}finally{await flushLibrary(ctx);libCache.delete(ctx);await closeLX(ctx);}}
async function download(ctx,input={}){
 if(input.action==='remove')return await manage(ctx,input);
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>200)throw new Error('每次请选择 1–200 首歌曲');
 const base=settingsOf(await ctx.settings.get());let cp=ctx.task.checkpointValue;
 if(cp?.musicDownload===1){if(cp.step==='done')return resultOf(cp);throw new Error('旧版未完成任务需要核对原有文件，请勿重复下载或复制。');}
 if(!cp?.musicDownload)cp={musicDownload:2,step:'start',index:0,completed:[],failed:[],current:null,choices:{resolverMode:base.resolverMode,lxSourceId:base.lxSourceId,quality:input.quality||base.quality,lyrics:base.lyrics,cover:base.cover,destination:base.destination,downloadTimeout:base.downloadTimeout,maxDownloadMB:base.maxDownloadMB}};
 const s=settingsOf({...base,...cp.choices});if(s.destination)s.destination=absoluteDirectory(s.destination);
 const checkpoint=async step=>{cp.step=step;try{await ctx.task.checkpoint(cp);}catch(e){const error=new Error('下载检查点保存失败：'+errorText(e));error.checkpointFailure=true;throw error;}};
 await ctx.task.update({total:input.items.length,done:cp.completed.length,failed:cp.failed.length});
 // Reserved paths from already-completed items in this run; maintained incrementally
 // instead of re-flattening cp.completed on every iteration (avoids O(n^2) string work).
 const reserved=new Set(cp.completed.flatMap(x=>x.files.map(f=>f.path)));
 for(;cp.index<input.items.length;){
  const item=normalizeSong(input.items[cp.index]);
  await ctx.task.update({stage:'resolve',message:`解析 ${item.artist} — ${item.title}`,done:cp.completed.length,failed:cp.failed.length});
  try{
   if(!item.id||(!item.origin&&s.resolverMode!=='lx'&&!PROVIDERS[item.source]))throw new Error('该音源已移除，请重新搜索可用版本；已有本地文件仍可播放。');
   if(!cp.current){
    const song=await resolveSong(ctx,s,item,{probe:!!item.origin||s.resolverMode==='lx'}),ext=String(song.ext||'mp3').toLowerCase();
    if(!extensions.has(ext))throw new Error('上游返回了不支持的音频格式');
    const pictureWarnings=[];if(s.cover&&song.origin){try{song.cover=await songPicture(ctx,s,song);}catch(e){pictureWarnings.push('封面：'+errorText(e));}}
    const directory=s.destination||'downloads';await ctx.files.call({operation:'mkdir',path:directory});
    const stem=await allocateStem(ctx,directory,song,ext,Array.from(reserved));
    cp.current={song,quality:s.quality,directory,storage:s.destination?'host':'plugin',stem,path:stem+'.'+ext,files:[],warnings:pictureWarnings,createdAt:Date.now(),pending:null};
    await checkpoint('prepared');
   }
   const record=cp.current;
   const pending=async(kind,path)=>{if(await exists(ctx,path))throw new Error('目标文件已经存在，未覆盖，请先核对：'+path);record.pending={kind,path};await checkpoint(kind==='audio'?'downloading':'sidecar');};
   if(!record.files.some(f=>f.kind==='audio')){
    await pending('audio',record.path);
    const r=await request(ctx,s,item.source,mediaURL(record.song.url),{...mediaOptions(record.song),save_to:record.path,timeout_seconds:s.downloadTimeout,max_bytes:s.maxDownloadMB*1048576,headers:DOWNLOAD_HEADERS});
    if(/text\/html|application\/json/.test(header(r,'content-type'))||!r.size||!r.sha256)throw new Error('上游未返回有效音频，目标文件需要核对，未加入资料库');
    const length=Number(header(r,'content-length')||0);
    if(length>0&&length!==r.size)throw new Error('下载文件大小校验失败，目标文件需要核对');
    // save_to reports bytes and SHA256 from native I/O. CD2 gRPC metadata may lag a completed mount write.
    if(record.storage==='plugin'){const stat=await ctx.files.call({operation:'stat',path:record.path});if(stat.size!==r.size)throw new Error('下载文件大小校验失败，目标文件需要核对');}
    record.files.push({path:record.path,size:r.size,sha256:r.sha256,kind:'audio'});record.song.size=r.size/1048576;record.pending=null;await checkpoint('downloaded');
   }
   if(!record.lyricsDone){
    if(s.lyrics){try{
     const content=await songLyrics(ctx,s,record.song);
     if(content){const path=record.stem+'.lrc';await pending('lyrics',path);const f=await ctx.files.call({operation:'write',path,content,encoding:'utf8'});record.files.push({path,...f,kind:'lyrics'});record.pending=null;}
     else record.warnings.push('音源未提供歌词');
    }catch(e){if(e.checkpointFailure||record.pending&&await exists(ctx,record.pending.path))throw e;record.pending=null;record.warnings.push('歌词：'+errorText(e));}}
    record.lyricsDone=true;await checkpoint('lyrics');
   }
   if(!record.coverDone){
    if(s.cover&&record.song.cover){try{
     const path=record.stem+'.jpg';await pending('cover',path);
     const image=await request(ctx,s,item.source,mediaURL(record.song.cover),{...mediaOptions(record.song),save_to:path,max_bytes:16*1048576,timeout_seconds:120});
     if(!/^image\//i.test(header(image,'content-type'))||!image.size||!image.sha256)throw new Error('封面不是有效的图片响应');
     record.files.push({path,size:image.size,sha256:image.sha256,kind:'cover'});record.coverPath=path;record.pending=null;
    }catch(e){if(e.checkpointFailure||record.pending&&await exists(ctx,record.pending.path))throw e;record.pending=null;record.warnings.push('封面：'+errorText(e));}}
    record.coverDone=true;await checkpoint('cover');
   }
   const {url,variants,alternatives,...saved}=record.song;record.song=saved;
   await checkpoint('remembering');await remember(ctx,record);
   cp.completed.push(record);record.files.forEach(f=>reserved.add(f.path));cp.index++;cp.current=null;await checkpoint('item-done');
  }catch(e){
   if(e.checkpointFailure||cp.step==='remembering'||cp.current?.pending&&await exists(ctx,cp.current.pending.path))throw e;
   cp.failed.push({song:item,error:errorText(e)});cp.index++;cp.current=null;await checkpoint('item-failed');
  }
  await ctx.task.update({done:cp.completed.length,failed:cp.failed.length});
 }
 await checkpoint('done');
 await ctx.task.update({stage:'complete',message:`已保存 ${cp.completed.length} 首${cp.failed.length?`，失败 ${cp.failed.length} 首`:''}`,done:cp.completed.length,failed:cp.failed.length});
 if(!cp.completed.length&&cp.failed.length)throw finishError(cp);
 return resultOf(cp);
}
export async function recover(ctx,cp){
 if(cp?.musicRemove)return await recoverManage(ctx,cp);
 if(!cp?.musicDownload)return{action:'attention'};
 if(cp.step==='done')return cp.completed.length||!cp.failed.length?{action:'complete',result:resultOf(cp)}:{action:'resume'};
 if(cp.musicDownload!==2)return{action:'attention'};
 if(cp.current?.pending){try{if(await exists(ctx,cp.current.pending.path))return{action:'attention'};}catch{return{action:'attention'};}}
 for(const file of cp.current?.files||[]){try{if(!await matches(ctx,file))return{action:'attention'};}catch{return{action:'attention'};}}
 return{action:'resume'};
}
