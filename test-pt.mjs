import assert from 'node:assert';
import {ptTorrentToSong,pickDownloader} from './src/lib/pt.js';
import {settingsOf} from './src/lib/model.js';

// 1. torrent -> song 归一
const t={torrent_id:'123',title:'Jay Chou - 晴天 FLAC',site_name:'音乐乌托邦',category:'音乐',size:524288000,seeders:12,leechers:2,download_url:'https://site/dl/1',detail_url:'https://site/t/1',discount:'Free'};
const song=ptTorrentToSong(t,{id:9,name:'音乐乌托邦',downloader:'电影'});
assert.strictEqual(song.source,'pt');
assert.strictEqual(song.title,'Jay Chou - 晴天 FLAC');
assert.strictEqual(song.pt.site_id,9);
assert.strictEqual(song.pt.download_url,'https://site/dl/1');
assert.strictEqual(song.pt.discount,'Free');
console.log('torrent normalize OK:',song.title,'|',song.size.toFixed(1),'MB');

// 2. 免费模式保留 pt 源
let s=settingsOf({sources:['netease','pt','migu']});
assert.ok(s.sources.includes('pt'),'pt kept in free mode');
console.log('free-mode keeps pt:',s.sources);

// 3. 下载器解析链（mock ctx.api.get）
const mockDls={data:[{id:1,name:'电影',type:'qbittorrent',is_default:false},{id:2,name:'电视剧',type:'qbittorrent',is_default:false}]};
const ctx={api:{get:async p=>p==='/api/pt/downloaders'?mockDls:{data:[]}}};
assert.strictEqual(await pickDownloader(ctx,[]),'电影'); // 无偏好->第一个
assert.strictEqual(await pickDownloader(ctx,['电视剧']),'电视剧'); // 显式
assert.strictEqual(await pickDownloader(ctx,['不存在的','电视剧']),'电视剧'); // 回退
const mockDefault={data:[{id:1,name:'电影',is_default:false},{id:2,name:'电视剧',is_default:true}]};
const ctx2={api:{get:async()=>mockDefault}};
assert.strictEqual(await pickDownloader(ctx2,[]),'电视剧'); // 宿主默认优先
console.log('downloader chain OK');

// 4. 缺下载地址的种子提交应报错
const {ptSubmit}=await import('./src/lib/pt.js');
const ctx3={api:{get:async()=>mockDls,post:async()=>({data:{success:true}})}};
await assert.rejects(()=>ptSubmit(ctx3,{title:'x',pt:{site_id:9,download_url:''}}),/缺少下载地址|下载地址/);
console.log('ptSubmit guard OK');
console.log('ALL PT CHECKS PASSED');
