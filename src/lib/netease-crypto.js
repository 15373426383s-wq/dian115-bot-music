// Port of 0xHJK/music-dl: Linux-forward AES-ECB and WEAPI AES-CBC + raw RSA.
// These constants are public protocol parameters, not account credentials.
const MODULUS='00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
// Bounded 16-bit limbs avoid relying on BigInt support in the host's JS engine.
function trim(a){while(a.length>1&&a[a.length-1]===0)a.pop();return a;}
function fromHex(hex){const a=[];for(let n=hex.length;n>0;n-=4)a.push(parseInt(hex.slice(Math.max(0,n-4),n),16));return trim(a);}
function compare(a,b){if(a.length!==b.length)return a.length-b.length;for(let i=a.length-1;i>=0;i--)if(a[i]!==b[i])return a[i]-b[i];return 0;}
function addMod(a,b,m){const out=[];let carry=0;for(let i=0;i<Math.max(a.length,b.length);i++){const v=(a[i]||0)+(b[i]||0)+carry;out.push(v&65535);carry=v>>>16;}if(carry)out.push(carry);if(compare(out,m)>=0){let borrow=0;for(let i=0;i<out.length;i++){let v=out[i]-(m[i]||0)-borrow;borrow=v<0?1:0;if(borrow)v+=65536;out[i]=v;}}return trim(out);}
function multiplyMod(a,b,m){let out=[0],factor=a;for(let i=0;i<b.length;i++){let word=b[i];for(let j=0;j<16;j++){if(word&1)out=addMod(out,factor,m);word>>>=1;factor=addMod(factor,factor,m);}}return out;}
function rsaHex(hex){const m=fromHex(MODULUS);let value=fromHex(hex),out=[1],power=65537;while(power){if(power&1)out=multiplyMod(out,value,m);power>>>=1;if(power)value=multiplyMod(value,value,m);}return out.slice().reverse().map(n=>n.toString(16).padStart(4,'0')).join('').padStart(256,'0');}
export function linuxEncrypt(ctx,data){return String(ctx.crypto.aesEncrypt({mode:'ecb',key:ctx.codec.hexDecode('7246674226682325323F5E6544673A51'),data:JSON.stringify(data),padding:'pkcs7',output:'hex'})).toUpperCase();}
export function weapiEncrypt(ctx,data,fixedSecret){const secret=fixedSecret||ctx.codec.hexEncode(ctx.crypto.randomBytes(16)).slice(0,16);const aes=(value,key)=>ctx.crypto.aesEncrypt({mode:'cbc',key,iv:'0102030405060708',data:value,padding:'pkcs7',output:'base64'});const params=aes(aes(JSON.stringify(data),'0CoJUm6Qyw8W8jud'),secret);const reversed=[...secret].reverse().join('');return{params,encSecKey:rsaHex(ctx.codec.hexEncode(ctx.codec.utf8Encode(reversed)))};}
// LX's documented RSA_NO_PADDING uses a 128-byte, zero-left-padded message.
export function lxRawRSA(ctx,bytes,pem){
 if(bytes.length>128||typeof pem!=='string'||pem.length>8192)throw Error('音源脚本 RSA 参数超出范围');
 const der=ctx.codec.base64Decode(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,''));
 function node(start,end){if(start+2>end)throw Error('RSA 公钥格式无效');const tag=der[start++];let length=der[start++];if(length&128){const count=length&127;if(!count||count>3||start+count>end)throw Error('RSA 公钥长度无效');length=0;for(let i=0;i<count;i++)length=length*256+der[start++];}if(start+length>end)throw Error('RSA 公钥不完整');return{tag,start,end:start+length};}
 let seq=node(0,der.length);if(seq.tag!==48)throw Error('RSA 公钥格式无效');let a=node(seq.start,seq.end),b=node(a.end,seq.end);
 if(a.tag!==2){if(b.tag!==3||der[b.start]!==0)throw Error('仅支持 RSA PEM 公钥');seq=node(b.start+1,b.end);a=node(seq.start,seq.end);b=node(a.end,seq.end);}
 if(a.tag!==2||b.tag!==2)throw Error('RSA 公钥缺少模数');let modulus=Array.from(der.slice(a.start,a.end));while(modulus[0]===0)modulus.shift();if(modulus.length!==128)throw Error('音源脚本 RSA 仅支持原协议的 1024 位公钥');
 let power=0;for(const n of der.slice(b.start,b.end)){power=power*256+n;if(power>0xffffffff)throw Error('RSA 指数超出范围');}if(power<3)throw Error('RSA 指数无效');
 const m=fromHex(ctx.codec.hexEncode(modulus));let value=fromHex(ctx.codec.hexEncode(bytes)),out=[1];if(compare(value,m)>=0)throw Error('RSA 消息超过模数');
 while(power){if(power%2)out=multiplyMod(out,value,m);power=Math.floor(power/2);if(power)value=multiplyMod(value,value,m);}
 return ctx.codec.hexDecode(out.slice().reverse().map(n=>n.toString(16).padStart(4,'0')).join('').padStart(256,'0'));
}
