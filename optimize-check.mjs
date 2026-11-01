// Local smoke test: exercises the optimized backend paths with a mocked ctx.
// Not part of the plugin package (lives outside src/). Run: node optimize-check.mjs
import assert from 'node:assert'
import {settingsOf,safeName,normalizeSong,mergeSongs,parseFilter,filterSongs,pickVariants} from './src/lib/model.js'
import {mediaURL} from './src/lib/network.js'
import {prepareListen,listenLease} from './src/lib/listen.js'
import {allocateStem} from './src/jobs/download.js'
import {publicLXURL} from './src/lib/lx-runtime.js'

let pass=0,fail=0
const ok=(name,fn)=>{try{fn();console.log('  ✓',name);pass++}catch(e){console.error('  ✗',name,'\n   ',e.message);fail++}}

// --- model.js: settings normalization stays strict & safe ---
ok('settingsOf drops archived/unknown sources and clamps limits',()=>{
  const s=settingsOf({sources:['netease','bogus','qq'],limit:9999,downloadTimeout:9,maxDownloadMB:-5})
  assert.deepStrictEqual(s.sources,['netease','qq'])
  assert.strictEqual(s.limit,50)
  assert.strictEqual(s.downloadTimeout,60)
  assert.strictEqual(s.maxDownloadMB,0)
})
ok('safeName strips illegal chars and caps byte length',()=>{
  assert.strictEqual(safeName('A/B:*?"<>|.mp3'),'AB.mp3')
  assert.strictEqual(safeName(''),'未知曲目')
})
ok('mergeSongs dedupes by artist/title and prefers larger size',()=>{
  const list=mergeSongs([normalizeSong({source:'qq',id:'1',title:'X',artist:'Y',size:1}),normalizeSong({source:'netease',id:'2',title:'X',artist:'Y',size:9})])
  assert.strictEqual(list.length,1)
  assert.strictEqual(list[0].size,9)
  assert.strictEqual(list[0].alternatives.length,1)
})
ok('filterSongs honors size/length rules',()=>{
  const songs=[normalizeSong({title:'a',artist:'b',size:5}),normalizeSong({title:'c',artist:'d',size:20})]
  assert.strictEqual(filterSongs(songs,'size>10').length,1)
  assert.strictEqual(filterSongs(songs,'size<10').length,1)
})
ok('pickVariants orders by quality',()=>{
  const v=[{prefix:'F000',bitrate:999},{prefix:'M800',bitrate:320},{prefix:'C400',bitrate:128}]
  assert.deepStrictEqual(pickVariants(v,'high').map(x=>x.bitrate),[320,128,999])
})

// --- network.js / lx-runtime.js: address safety checks reject internal/115 hosts ---
ok('mediaURL rejects internal & 115 hosts',()=>{
  for(const u of ['http://127.0.0.1/x','http://localhost/a','http://10.0.0.1/b','https://www.115.com/c','https://115cdn.com/d'])
    assert.throws(()=>mediaURL(u),/无效|不支持/)
  assert.strictEqual(mediaURL('https://example.com/a.mp3'),'https://example.com/a.mp3')
})
ok('publicLXURL rejects reserved/intra ranges',()=>{
  for(const u of ['http://192.168.1.1/x','http://100.64.0.1/y','http://foo.local/z','http://example.internal/w'])
    assert.throws(()=>publicLXURL(u))
  assert.ok(publicLXURL('https://cdn.example.org/audio.flac'))
})

// --- download.js: allocateStem honors reserved set & collisions (increments) ---
ok('allocateStem returns base stem when free, increments on collision',async()=>{
  const existsMap={'/dir/Artist - Title.mp3':true}
  const ctx={files:{call:async({operation,path})=>operation==='exists'?!!existsMap[path]:null}}
  const song={artist:'Artist',title:'Title'}
  const first=await allocateStem(ctx,'/dir',song,'mp3',[])
  assert.strictEqual(first,'/dir/Artist - Title')
  const second=await allocateStem(ctx,'/dir',song,'mp3',['/dir/Artist - Title.mp3'])
  assert.strictEqual(second,'/dir/Artist - Title (1)')
})

// --- listen.js: lease store keeps at most 32 entries ---
ok('prepareListen caps stored leases at 32',async()=>{
  const store={}
  const ctx={storage:{get:k=>store[k],set:(k,v)=>{store[k]=v}},codec:{hexEncode:b=>Buffer.from(b).toString('hex')},crypto:{randomBytes:n=>new Uint8Array(n).map((_,i)=>i%256)}}
  const settings=settingsOf({})
  // build a fake resolved song with a public URL
  const song={source:'netease',id:'1',title:'t',artist:'a',url:'https://cdn.example.org/a.mp3',ext:'mp3'}
  for(let i=0;i<40;i++) await prepareListen(ctx,settings,song,'best')
  const leases=await ctx.storage.get('listen:leases')
  assert.strictEqual(leases.length,32,'expected at most 32 leases')
  const found=await listenLease(ctx,leases[leases.length-1].token)
  assert.ok(found,'newest lease should be retrievable')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
