import {settingsOf,normalizeSong} from './model.js';
import {resolveSong} from './lx-sources.js';
import {publicLXURL} from './lx-runtime.js';
const KEY='listen:leases',TTL=2*60*60*1000;
export async function prepareListen(ctx,settings,song,quality){
 const s=settingsOf({...settings,quality:quality||settings.quality,playback:true});
 const resolved=await resolveSong(ctx,s,normalizeSong(song),{probe:true,playable:true});
 const url=publicLXURL(resolved.url),token=ctx.codec.hexEncode(ctx.crypto.randomBytes(32)),expiresAt=Date.now()+TTL;
 const lease={token,url,source:resolved.source,scriptId:resolved.origin?.scriptId||'',ext:resolved.ext,expiresAt};
 const old=await ctx.storage.get(KEY),leases=(Array.isArray(old)?old:[]).filter(x=>x.expiresAt>Date.now()).slice(-32);
 await ctx.storage.set(KEY,[...leases,lease]);
 const {url:privateURL,variants,alternatives,...publicSong}=resolved;
 return{song:publicSong,path:'listen/'+token,expiresAt};
}
export async function listenLease(ctx,token){
 const records=await ctx.storage.get(KEY);
 return(Array.isArray(records)?records:[]).find(x=>x.token===token&&x.expiresAt>Date.now());
}
