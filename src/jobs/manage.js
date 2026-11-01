import {trackKey} from '../lib/model.js';
function ownPath(path){return typeof path==='string'&&path.startsWith('downloads/')&&!path.includes('..')&&!path.includes('\\');}
export async function run(ctx,input={}){
 if(input.action!=='remove'||input.confirmed!==true)throw new Error('移除歌曲需要页面明确确认');
 let cp=ctx.task.checkpointValue;const records=await ctx.storage.get('library')||[];
 if(!cp?.musicRemove){const record=records.find(x=>x.path===input.path);if(!record)return{removed:true,alreadyAbsent:true};cp={musicRemove:1,record,index:0,step:'start'};}
 if(!Array.isArray(cp.record.files)||cp.record.storage!=='host'&&!cp.record.files.every(f=>ownPath(f.path)))throw new Error('只能移除本插件资料库中的音乐文件');
 await ctx.task.update({stage:'remove',message:'移除资料库版本：'+cp.record.song.title,total:cp.record.files.length,done:cp.index,failed:0});
 for(;cp.index<cp.record.files.length;){const file=cp.record.files[cp.index];cp.step='removing';await ctx.task.checkpoint(cp);if(cp.record.storage!=='host'&&await ctx.files.call({operation:'exists',path:file.path}))await ctx.files.call({operation:'remove',path:file.path});cp.index++;await ctx.task.checkpoint(cp);}
 const current=await ctx.storage.get('library')||[];await ctx.storage.set('library',current.filter(x=>x.path!==cp.record.path));cp.step='done';await ctx.task.checkpoint(cp);await ctx.task.update({done:cp.record.files.length,message:'已移除资料库版本：'+cp.record.song.title});return{removed:true,key:trackKey(cp.record.song),path:cp.record.path};
}
export async function recover(ctx,cp){if(!cp?.musicRemove)return{action:'attention'};if(cp.step==='done')return{action:'complete',result:{removed:true,path:cp.record.path}};return{action:'resume'};}
