export function absoluteDirectory(value){
 if(typeof value!=='string'||!value.startsWith('/')||/[\\\0\r\n]/.test(value))throw new Error('请选择有效的宿主目录');
 const parts=value.split('/').filter(Boolean);if(parts.some(part=>part==='.'||part==='..'))throw new Error('目录不能包含路径跳转');
 return '/'+parts.join('/');
}
export function directoryParent(path){const parts=absoluteDirectory(path).split('/').filter(Boolean);parts.pop();return '/'+parts.join('/');}
export function directoryCrumbs(path){const parts=absoluteDirectory(path).split('/').filter(Boolean);return[{name:'宿主目录',path:'/'},...parts.map((name,i)=>({name,path:'/'+parts.slice(0,i+1).join('/')}))];}
export async function listDirectories(ctx,path){
 const requested=absoluteDirectory(path);
 const data=await ctx.api.get('/api/local-dirs?path='+encodeURIComponent(requested));
 if(!data||!Array.isArray(data.entries))throw new Error('宿主没有返回有效的目录列表');
 const current=absoluteDirectory(data.current||requested),prefix=current==='/'?'/':current+'/';
 const entries=[],seen=new Set();
 for(const entry of data.entries){
  if(entry?.is_dir!==true)continue;
  const target=absoluteDirectory(entry.path);
  if(target===current||!target.startsWith(prefix)||seen.has(target))continue;
  seen.add(target);entries.push({name:String(entry.name||target.split('/').pop()),path:target});
 }
 entries.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
 return{current,entries};
}
