import assert from 'node:assert';
import {settingsOf,SOURCES} from './src/lib/model.js';
import {pickDownloader} from './src/lib/pt.js';

// 1) 模拟 UI 保存后的设置：勾了 PT、选了下载器、cookies 里没有 pt
const saved={sources:['netease','qq','kugou','migu','pt'],resolverMode:'original',lxSourceId:'',lxCatalogs:{},limit:20,quality:'best',freeMode:true,merge:true,lyrics:true,cover:true,autoPlay:false,destination:'',proxy:'',downloadTimeout:3600,maxDownloadMB:0,ptDownloader:'电影',theme:'system',reduceTransparency:false,cookies:{netease:'',qq:'',kugou:'',migu:''},cookieRecords:{netease:[],qq:[],kugou:[],migu:[]}};
const s=settingsOf(saved);
assert.ok(s.sources.includes('pt'),'pt source preserved');
assert.strictEqual(s.ptDownloader,'电影');
assert.strictEqual(s.cookies.pt,'','no crash, pt cookie padded empty');
console.log('1) settings with pt + ptDownloader OK ->',s.sources.join(','),'| downloader:',s.ptDownloader);

// 2) ptDownloader 非法值归一
assert.strictEqual(settingsOf({ptDownloader:123}).ptDownloader,'');
assert.strictEqual(settingsOf({ptDownloader:'  电影  '}).ptDownloader,'电影');
console.log('2) ptDownloader normalization OK');

// 3) 只勾 pt（freeMode 下不被回退成网易云）
const only=settingsOf({sources:['pt']});
assert.deepStrictEqual(only.sources,['pt']);
console.log('3) pt-only stays pt:',only.sources);

// 4) 下载器解析：设置项优先级高于站点默认/宿主默认
const mock={data:[{id:1,name:'电影',is_default:!1},{id:2,name:'电视剧',is_default:!0}]};
const ctx={api:{get:async()=>mock}};
assert.strictEqual(await pickDownloader(ctx,['电影']),'电影');
assert.strictEqual(await pickDownloader(ctx,['']),'电视剧');
console.log('4) downloader pick OK');
console.log('ALL 1.4.1 CHECKS PASSED');
