function json(body,status=200,extra={}){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra}})}
export async function onRequest({request}){
 if(request.method!=="GET")return json({error:"Use GET for image previews."},405,{Allow:"GET"});
 try{
  const q=new URL(request.url).searchParams,source=new URL(String(q.get("url")||"")),ra=Number(q.get("ra")),dec=Number(q.get("dec")),size=Number(q.get("size")||0.1);
  if(source.protocol!=="https:"||source.hostname!=="irsa.ipac.caltech.edu"||!source.pathname.startsWith("/ibe/data/spherex/")||!source.pathname.endsWith(".fits"))return json({error:"Only official SPHEREx FITS image products can be previewed."},400);
  if(!Number.isFinite(ra)||ra<0||ra>360||!Number.isFinite(dec)||dec< -90||dec>90||!Number.isFinite(size)||size<=0||size>0.5)return json({error:"Invalid image cutout coordinates or size."},400);
  // Keep preview cutouts deliberately small: parent SPHEREx MEFs can be large.
  // Retry temporary IRSA failures before reporting that the preview is unavailable.
  const sizes=[Math.min(0.2,Math.max(0.1,size)),0.1].filter((v,i,a)=>a.indexOf(v)===i);
  let upstream,lastStatus=0,lastError="";
  for(let i=0;i<3;i++){
    const cutoutSize=sizes[Math.min(i,sizes.length-1)];
    const u=new URL(source.toString());
    u.searchParams.set("center",ra+","+dec);
    u.searchParams.set("size",String(cutoutSize));
    u.searchParams.set("gzip","false");
    try{
      upstream=await fetch(u.toString(),{
        headers:{Accept:"application/fits, application/octet-stream"},
        signal:AbortSignal.timeout(15000)
      });
      if(upstream.ok)break;
      lastStatus=upstream.status;
      lastError="IRSA returned HTTP "+lastStatus;
      if(![429,500,502,503,504].includes(lastStatus))break;
    }catch(error){
      lastError=error?.name==="TimeoutError"?"IRSA cutout request timed out":(error?.message||"Network error");
      lastStatus=0;
    }
    if(i<2)await new Promise(resolve=>setTimeout(resolve,1000*(i+1)));
  }
  if(!upstream||!upstream.ok)return json({
    error:"IRSA SPHEREx cutout service is temporarily unavailable.",
    detail:"The observation record exists, but IRSA could not generate its small image preview after 3 attempts. "+(lastError||"Please try again later.")+" You can still open the original FITS product.",
    retryable:true
  },lastStatus===503?503:502,{"Retry-After":"30"});
  const bytes=await upstream.arrayBuffer();if(bytes.byteLength<2880||new TextDecoder().decode(bytes.slice(0,8)).indexOf("SIMPLE")!==0)return json({error:"IRSA did not return a readable FITS image."},502);
  return new Response(bytes,{status:200,headers:{"Content-Type":"application/fits","Content-Length":String(bytes.byteLength),"Cache-Control":"public, max-age=3600",'Content-Disposition':'inline; filename="spherex-cutout.fits"'}});
 }catch(error){return json({error:"Could not retrieve the SPHEREx image cutout.",detail:error?.message||"Unknown error."},502)}
}