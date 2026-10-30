import https from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';

const invalid=message=>Object.assign(new Error(message),{status:400});
export function publicSourceAddress(address){
  const family=isIP(address);
  if(family===4){
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
  }
  if(family===6){
    // Only global unicast is accepted. This also excludes IPv4-mapped, local,
    // link-local, multicast and unspecified addresses, including bracket aliases.
    const groups=address.toLowerCase().split(':'),first=parseInt(groups[0]||'0',16),second=parseInt(groups[1]||'0',16);
    return first>=0x2000&&first<0x4000&&first!==0x2002&&first!==0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8));
  }
  return false;
}
export function assertSafeHttpsUrl(value){
  if(typeof value!=='string'||value.length>20000||/[\u0000-\u0020\u007f]/.test(value))throw invalid('Invalid source URL');
  let url;try{url=new URL(value);}catch{throw invalid('Invalid source URL');}
  if(url.protocol!=='https:'||url.username||url.password)throw invalid('Only HTTPS source URLs without credentials are allowed');
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||(isIP(host)&&!publicSourceAddress(host)))throw invalid('Private/internal source URLs are not allowed');
  return url;
}
export async function downloadUrlToBuffer(sourceUrl,maxBytes=20*1024*1024,{lookup=dnsLookup,request=https.request}={}){
  let current=assertSafeHttpsUrl(sourceUrl);
  const limitError=()=>invalid('Source file exceeds '+Math.floor(maxBytes/1024/1024)+' MB limit');
  for(let attempt=0;attempt<5;attempt++){
    const hostname=current.hostname.replace(/^\[|\]$/g,''),family=isIP(hostname);
    const addresses=family?[{address:hostname,family}]:await lookup(hostname,{all:true,verbatim:true});
    if(!addresses.length||addresses.some(item=>!publicSourceAddress(item.address)))throw invalid('Private/internal source addresses are not allowed');
    const address=addresses.find(item=>item.family===4)||addresses[0];
    const response=await new Promise((resolve,reject)=>{
      const req=request(current,{
        method:'GET',signal:AbortSignal.timeout(20000),
        headers:{'user-agent':'Tsubera-Document-Importer/2.0','accept-encoding':'identity'},
        // DNS was validated above. Pin the chosen address while TLS still verifies
        // the original URL hostname, preventing a second DNS lookup/rebinding.
        lookup:(_host,options,callback)=>{
          if(typeof options==='function'){callback=options;options={};}
          if(options.all)callback(null,[address]);else callback(null,address.address,address.family);
        }
      },async res=>{
        try{
          const status=res.statusCode||0;
          if(status>=300&&status<400){const location=res.headers.location;res.destroy();if(!location)throw invalid('Source URL redirected without a Location header');resolve({location});return;}
          if(status<200||status>=300){res.destroy();throw invalid('Could not fetch source file: HTTP '+status);}
          const length=Number(res.headers['content-length']||0);
          if(length>maxBytes){res.destroy();throw limitError();}
          const encoding=String(res.headers['content-encoding']||'identity').toLowerCase();
          if(encoding!=='identity'){res.destroy();throw invalid('Source server must return original uncompressed file bytes');}
          let total=0;const chunks=[];
          for await(const chunk of res){total+=chunk.length;if(total>maxBytes){res.destroy();throw limitError();}chunks.push(chunk);}
          if(!total)throw invalid('Source file is empty');
          resolve({buffer:Buffer.concat(chunks),mime:res.headers['content-type']||'application/octet-stream',finalUrl:current.toString()});
        }catch(error){reject(error);}
      });
      req.on('error',reject);req.end();
    });
    if(response.location){current=assertSafeHttpsUrl(new URL(response.location,current).toString());continue;}
    return response;
  }
  throw invalid('Too many redirects while fetching source file');
}
