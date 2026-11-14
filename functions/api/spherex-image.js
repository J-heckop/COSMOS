function json(body,status=200,extra={}){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra}})}
export async function onRequest({request}){
 if(request.method!=="GET")return json({error:"Use GET for image previews."},405,{Allow:"GET"});
 try{
  const q=new URL(request.url).searchParams,source=new URL(String(q.get("url")||""));
  if(source.protocol!=="https:"||source.hostname!=="irsa.ipac.caltech.edu"||!source.pathname.startsWith("/ibe/data/spherex/")||!source.pathname.endsWith(".fits"))
   return json({error:"Only official SPHEREx FITS image products can be opened."},400);
  // Default to a fast, scientifically valid 0.1-degree SPHEREx preview cutout.
  // Keep the original product URL separately available in the page for full-resolution access.
  const center=String(q.get("center")||"");
  const size=Number(q.get("size")||0.1);
  const parts=center.split(",").map(Number);
  if(parts.length!==2||!parts.every(Number.isFinite)||parts[0]<0||parts[0]>360||parts[1]<-90||parts[1]>90||!Number.isFinite(size)||size<=0||size>0.5)
    return json({error:"Invalid preview position or size."},400);
  source.search="";
  source.searchParams.set("center",parts[0]+","+parts[1]);
  source.searchParams.set("size",String(size));
  source.searchParams.set("gzip","false");
  // Retry transient IRSA failures once with a smaller cutout. Do not retry
  // non-transient errors, and keep the total wait bounded for mobile users.
  let upstream=null,lastStatus=0,usedSize=size;
  for(let attempt=0;attempt<2;attempt++){
   usedSize=attempt===0?size:Math.min(size,0.05);
   source.searchParams.set("size",String(usedSize));
   try{
    upstream=await fetch(source.toString(),{
     headers:{Accept:"application/fits, application/octet-stream"},
     signal:AbortSignal.timeout(22000)
    });
    if(upstream.ok)break;
    lastStatus=upstream.status;
    if(![429,500,502,503,504].includes(lastStatus)||attempt===1)break;
    try{await upstream.body?.cancel()}catch{}
   }catch(error){
    if(attempt===1)throw error;
   }
  }
  if(!upstream||!upstream.ok){
   const retryable=[429,500,502,503,504].includes(lastStatus);
   return json({
    error:"The SPHEREx preview cutout could not be retrieved.",
    detail:"IRSA returned HTTP "+(lastStatus||"network error")+" after "+(upstream?"a smaller-cutout retry":"the request")+". "+(retryable?"The archive image service is temporarily unavailable; try again later or open the original FITS product.":"Check the original archive product link."),
    retryable
   },lastStatus===503?503:502,{"Retry-After":"30"});
  }
  const contentLength=Number(upstream.headers.get("content-length")||0);
  if(contentLength>100*1024*1024)return json({error:"This original FITS product is larger than the 100 MB preview limit.",detail:"Open the original FITS product directly or choose a smaller observation product."},413);
  if(!upstream.body)return json({error:"IRSA returned an empty FITS product."},502);
  return new Response(upstream.body,{status:200,headers:{
   "Content-Type":"application/fits",
   ...(contentLength?{"Content-Length":String(contentLength)}:{}),
   "Cache-Control":"public, max-age=3600",
   "Content-Disposition":'inline; filename="spherex-original.fits"'
  }});
 }catch(error){
  const timedOut=error?.name==="TimeoutError";
  return json({error:"Could not retrieve the original SPHEREx FITS product.",detail:timedOut?"The preview cutout took too long. Try again or open the original product directly.":(error?.message||"Unknown error."),retryable:true},502,{"Retry-After":"30"});
 }
}
