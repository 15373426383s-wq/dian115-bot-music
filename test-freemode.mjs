import assert from 'node:assert';
import {settingsOf} from './src/lib/model.js';
// 无 CK：免费模式生效
let s=settingsOf({});
assert.strictEqual(s.freeMode,true);
assert.deepStrictEqual(s.sources,['netease','kugou']);
assert.strictEqual(s.quality,'high');
// 无 CK 时 best 也被压到 high
s=settingsOf({quality:'best'});
assert.strictEqual(s.quality,'high');
// 用户只选了 migu+qq -> 回退到免费源
s=settingsOf({sources:['migu','qq']});
assert.deepStrictEqual(s.sources,['netease','kugou']);
// 有网易云 CK：保留 netease，QQ/咪咕（无 CK）仍排除，音质不限制（可无损）
s=settingsOf({sources:['netease','qq','kugou','migu'],quality:'best',cookies:{netease:'MUSIC_U=abc'}});
console.log('有网易云CK -> sources:',s.sources,'quality:',s.quality);
assert.deepStrictEqual(s.sources,['netease','kugou']);
assert.strictEqual(s.quality,'best');
// 有 QQ CK：QQ 源恢复可用
s=settingsOf({sources:['netease','qq','kugou','migu'],cookies:{qq:'uin=123'}});
console.log('有QQ CK -> sources:',s.sources,'quality:',s.quality);
assert.deepStrictEqual(s.sources,['netease','qq','kugou']);
// 全部有 CK：全部保留
s=settingsOf({cookies:{netease:'a=1',qq:'b=2',kugou:'c=3',migu:'d=4'}});
assert.deepStrictEqual(s.sources,['netease','qq','kugou','migu']);
// lx 模式不受限
s=settingsOf({resolverMode:'lx',sources:['migu']});
assert.deepStrictEqual(s.sources,['migu']);
console.log('ALL FREE-MODE (adaptive) CHECKS PASSED');
