import {PROVIDERS} from './providers.js';
import {errorText} from './model.js';
// 首页推荐：直接取网易云公开榜单（无需任何 Cookie），插件只做归一与分块，
// 不引入额外的推荐算法或第三方服务。
const CHARTS=[
 {id:'3778678',title:'热歌榜',caption:'此刻最多人在听'},
 {id:'3779629',title:'新歌榜',caption:'刚刚上架的新声音'},
 {id:'19723756',title:'飙升榜',caption:'热度上升最快'}
];
const CACHE='discover:charts';
const TTL=30*60*1000;
// 缓存只保留播放/解析真正需要的字段，避免把整份榜单明细写进插件存储。
const slim=song=>({id:song.id,source:song.source,title:song.title,artist:song.artist,album:song.album,cover:song.cover,duration:song.duration,size:song.size});

export async function discover(ctx,s,{limit=8,refresh=false}={}){
 const size=Math.max(1,Math.min(20,Number(limit)||8));
 const now=Date.now();
 if(!refresh){
  try{
   const c=await ctx.storage.get(CACHE);
   if(c&&c.limit===size&&Array.isArray(c.items)&&c.items.length&&now-c.at<TTL)return{...c,cached:true};
  }catch{}
 }
 const sections=await Promise.all(CHARTS.map(async chart=>{
  try{
   const r=await PROVIDERS.netease.playlist(ctx,s,`https://music.163.com/playlist?id=${chart.id}`);
   return {id:chart.id,title:r.title||chart.title,caption:chart.caption,ok:true,items:(r.items||[]).slice(0,size)};
  }catch(e){
   return {id:chart.id,title:chart.title,caption:chart.caption,ok:false,items:[],error:errorText(e)};
  }
 }));
 // 交错合并成一条扁平列表，首页一屏就能看到各榜的好歌
 const items=[];
 for(let i=0;i<size;i++)for(const sec of sections)if(sec.items[i])items.push(sec.items[i]);
 const data={sections,items,at:now,limit:size};
 if(items.length){
  try{await ctx.storage.set(CACHE,{items:items.map(slim),sections:sections.map(x=>({id:x.id,title:x.title,caption:x.caption,ok:x.ok,count:x.items.length})),at:now,limit:size});}catch{}
 }
 return data;
}
