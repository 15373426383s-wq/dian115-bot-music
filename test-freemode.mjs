import assert from 'node:assert';
import {settingsOf,FREE_SOURCES} from './src/lib/model.js';
// default (freeMode on) should restrict to netease+kugou and cap quality
let s=settingsOf({});
console.log('default freeMode:',s.freeMode,'sources:',s.sources,'quality:',s.quality);
assert.strictEqual(s.freeMode,true);
assert.deepStrictEqual(s.sources,['netease','kugou']);
assert.strictEqual(s.quality,'high');
// explicit best quality still capped in free mode
s=settingsOf({quality:'best'});
assert.strictEqual(s.quality,'high');
// user picked only migu+qq -> free mode falls back to FREE_SOURCES
s=settingsOf({sources:['migu','qq']});
assert.deepStrictEqual(s.sources,['netease','kugou']);
// freeMode OFF respects user choices
s=settingsOf({freeMode:false,sources:['netease','qq','kugou','migu'],quality:'lossless'});
console.log('freeMode OFF sources:',s.sources,'quality:',s.quality);
assert.deepStrictEqual(s.sources,['netease','qq','kugou','migu']);
assert.strictEqual(s.quality,'lossless');
// lx mode not restricted by free mode
s=settingsOf({resolverMode:'lx',sources:['migu']});
assert.deepStrictEqual(s.sources,['migu']);
console.log('ALL FREE-MODE CHECKS PASSED');
