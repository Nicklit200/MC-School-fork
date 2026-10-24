/* Small QR encoder. Versions 6-L / 11-L, byte mode, mask 0.
 * Matrix placement adapted from python-qrcode (BSD), attribution in LICENSES.txt.
 * Short addresses keep the original compact symbol. Production addresses may
 * contain up to 321 UTF-8 bytes. No online QR service or dependencies. */
export function qrMatrix(text) {
 const bytes=new TextEncoder().encode(text);if(bytes.length>321)throw new Error('Адрес слишком длинный для QR-кода.');
 const version=bytes.length<=134?6:11,blockCount=version===6?2:4,blockSize=version===6?68:81,eccSize=version===6?18:20;
 const dataCount=blockCount*blockSize,alignment=version===6?[6,34]:[6,30,54];
 const bits=[];const push=(v,n)=>{for(let i=n-1;i>=0;i--)bits.push((v>>>i)&1);};
 push(4,4);push(bytes.length,version<10?8:16);for(const b of bytes)push(b,8);
 for(let i=0,n=Math.min(4,dataCount*8-bits.length);i<n;i++)bits.push(0);
 while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=b*2+bits[i+j];data.push(b);}
 for(let n=0;data.length<dataCount;n++)data.push(n%2?17:236);
 const exp=new Uint8Array(512),log=new Uint8Array(256);let x=1;
 for(let i=0;i<255;i++){exp[i]=x;log[x]=i;x<<=1;if(x&256)x^=285;}for(let i=255;i<512;i++)exp[i]=exp[i-255];
 const mul=(a,b)=>a&&b?exp[log[a]+log[b]]:0;let gen=[1];
 for(let i=0;i<eccSize;i++){const next=new Array(gen.length+1).fill(0);gen.forEach((g,j)=>{next[j]^=g;next[j+1]^=mul(g,exp[i]);});gen=next;}
 const blocks=Array.from({length:blockCount},(_,i)=>data.slice(i*blockSize,(i+1)*blockSize));
 const ec=blocks.map(b=>{const r=[...b,...new Array(eccSize).fill(0)];for(let i=0;i<blockSize;i++){const lead=r[i];for(let j=0;j<gen.length;j++)r[i+j]^=mul(gen[j],lead);}return r.slice(blockSize);});
 const words=[];for(let i=0;i<blockSize;i++)for(const b of blocks)words.push(b[i]);for(let i=0;i<eccSize;i++)for(const b of ec)words.push(b[i]);
 const N=version*4+17,m=Array.from({length:N},()=>new Array(N).fill(null));
 for(const [r,c]of [[0,0],[0,N-7],[N-7,0]])for(let y=-1;y<=7;y++)for(let z=-1;z<=7;z++){if(r+y<0||r+y>=N||c+z<0||c+z>=N)continue;m[r+y][c+z]=(y>=0&&y<=6&&(z===0||z===6))||(z>=0&&z<=6&&(y===0||y===6))||(y>=2&&y<=4&&z>=2&&z<=4);}
 for(const r of alignment)for(const c of alignment)if(m[r][c]===null)for(let y=-2;y<=2;y++)for(let z=-2;z<=2;z++)m[r+y][c+z]=Math.abs(y)===2||Math.abs(z)===2||(y===0&&z===0);
 for(let i=8;i<N-8;i++){if(m[i][6]===null)m[i][6]=i%2===0;if(m[6][i]===null)m[6][i]=i%2===0;}
 let rem=8<<10;const degree=n=>31-Math.clz32(n);while(degree(rem)>=10)rem^=0x537<<(degree(rem)-10);const fmt=((8<<10)|rem)^0x5412;
 for(let i=0;i<15;i++){const v=!!((fmt>>i)&1);m[i<6?i:i<8?i+1:N-15+i][8]=v;m[8][i<8?N-i-1:i<9?15-i:14-i]=v;}m[N-8][8]=true;
 if(version>=7){let r=version<<12;while(degree(r)>=12)r^=0x1f25<<(degree(r)-12);const value=(version<<12)|r;for(let i=0;i<18;i++){const v=!!((value>>i)&1),a=N-11+i%3,b=Math.floor(i/3);m[b][a]=v;m[a][b]=v;}}
 let row=N-1,dir=-1,bit=0;for(let col=N-1;col>0;col-=2){if(col===6)col--;while(true){for(const c of [col,col-1])if(m[row][c]===null){const v=bit<words.length*8?!!((words[bit>>3]>>(7-(bit&7)))&1):false;m[row][c]=v!==((row+c)%2===0);bit++;}row+=dir;if(row<0||row>=N){row-=dir;dir=-dir;break;}}}
 return m;
}
export function drawQR(canvas,text){const m=qrMatrix(text),scale=6,border=4,size=m.length+border*2;canvas.width=canvas.height=size*scale;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111827';m.forEach((r,y)=>r.forEach((v,x)=>{if(v)ctx.fillRect((x+border)*scale,(y+border)*scale,scale,scale);}));}
