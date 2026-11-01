import {normalizeSong,errorText} from './model.js';
// PT 搜索与下载：全部走宿主 /api/pt/*（进程内 ctx.api），站点凭据、限速、
// 超时与代理均由宿主按站点配置执行，本插件只做选择、轮询与结果归一。
const num=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};

export async function ptSites(ctx){
 const r=await ctx.api.get('/api/pt/sites');
 return Array.isArray(r?.data)?r.data:[];
}

export async function ptDownloaders(ctx){
 const r=await ctx.api.get('/api/pt/downloaders');
 return Array.isArray(r?.data)?r.data:[];
}

// 下载器解析链：显式指定 > 用户设置 > 站点默认 > 宿主默认 > 第一个下载器。
export async function pickDownloader(ctx,preferred=[]){
 const list=await ptDownloaders(ctx);
 if(!list.length)throw new Error('DIAN115 中还没有添加下载器，请先在宿主 PT 设置里添加');
 for(const name of preferred){const hit=list.find(d=>d.name===name);if(hit)return hit.name;}
 const byDefault=list.find(d=>d.is_default===true);
 if(byDefault)return byDefault.name;
 return [...list].sort((a,b)=>num(a.id)-num(b.id))[0].name;
}

export function ptTorrentToSong(torrent,site){
 const t=torrent||{};
 return normalizeSong({
  source:'pt',
  id:String(t.torrent_id||t.info_hash||''),
  title:t.title||'未知种子',
  artist:t.site_name||site?.name||'PT',
  album:t.category||'',
  size:num(t.size)/1048576,
  cover:'',
  // PT 专属字段挂在 pt 下，播放/解析流程会忽略，下载流程据此路由
  pt:{
   site_id:num(t.site_id??site?.id),
   site_name:t.site_name||site?.name||'',
   downloader:site?.downloader||'',
   download_url:t.download_url||'',
   detail_url:t.detail_url||'',
   seeders:num(t.seeders),
   leechers:num(t.leechers),
   publish_time:t.publish_time||'',
   discount:t.discount||t.free_type||''
  }
 });
}

// 轮询搜索：按站点 priority 升序逐站请求，单站失败不影响其他站，
// 每站一页、条数克制，把节奏控制交给宿主站点的限速配置。
export async function ptSearch(ctx,{query,siteIds=[],page=1,pageSize=20}){
 const sites=await ptSites(ctx);
 const usable=sites.filter(s=>s.enabled!==false&&s.search_enabled!==false);
 let targets;
 if(Array.isArray(siteIds)&&siteIds.length){
  const wanted=new Set(siteIds.map(num));
  targets=usable.filter(s=>wanted.has(num(s.id)));
  if(!targets.length)throw new Error('所选 PT 站未启用或不支持搜索，请先在宿主 PT 设置里启用');
 }else targets=usable;
 if(!targets.length)throw new Error('DIAN115 中没有已启用的 PT 站：请先在宿主 PT 设置里启用站点并测试通过');
 targets.sort((a,b)=>num(a.priority)-num(b.priority));
 const items=[],parts=[];
 for(const site of targets){
  const at=Date.now();
  try{
   const r=await ctx.api.post('/api/pt/search',{keyword:query,site_ids:[num(site.id)],page:Math.max(1,num(page)||1),page_size:Math.min(50,Math.max(1,num(pageSize)||20))});
   const list=Array.isArray(r?.data?.torrents)?r.data.torrents:[];
   items.push(...list.map(t=>ptTorrentToSong(t,site)));
   parts.push({source:'pt',site:site.name,siteId:site.id,ok:true,count:list.length,ms:Date.now()-at});
  }catch(e){parts.push({source:'pt',site:site.name,siteId:site.id,ok:false,count:0,error:errorText(e),ms:Date.now()-at});}
 }
 if(!parts.some(p=>p.ok))throw new Error('所有 PT 站搜索失败：'+(parts.find(p=>p.error)?.error||'未知原因'));
 return {items,parts,total:items.length};
}

// 提交宿主下载器。成功与否看 data.success；state_uncertain 时提示用户先核对下载器。
export async function ptSubmit(ctx,song,downloader){
 const pt=song.pt||{};
 if(!pt.download_url)throw new Error('该种子缺少下载地址，请重新搜索后再试');
 const chosen=await pickDownloader(ctx,[downloader,pt.downloader].filter(Boolean));
 const body={site_id:num(pt.site_id),site_name:pt.site_name||'',title:song.title||'',download_url:pt.download_url,tag:'拾音Music',downloader:chosen};
 let r;
 try{r=await ctx.api.post('/api/pt/download',body);}
 catch(e){throw new Error('提交下载器失败：'+errorText(e));}
 const d=r?.data||{};
 if(d.success===false)throw new Error(d.error||'下载器提交失败');
 return{success:true,downloader:d.downloader||chosen,download_id:d.download_id||'',already_existed:d.already_existed===true,state_uncertain:d.state_uncertain===true};
}
