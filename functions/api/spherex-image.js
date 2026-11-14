function json(body,status=200,extra={}){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra}})}
export async function onRequest({request}){
 if(request.method!=="GET")return json({error:"Use GET for image previews."},405,{Allow:"GET"});
 try{
  const q=new URL(request.url).searchParams,source=new URL(String(q.get("url")||""));
  if(source.protocol!=="https:"||source.hostname!=="irsa.ipac.caltech.edu"||!source.pathname.startsWith("/ibe/data/spherex/")||!source.pathname.endsWith(".fits"))
   return json({error:"Only official SPHEREx FITS image products can be opened."},400);
  // Fetch the original archive product. Do not add center/size cutout parameters:
  // those shrink the observation to a tiny postage stamp and discard surrounding pixels.
  source.searchParams.delete("center");
  source.searchParams.delete("size");
  source.searchParams.delete("gzip");
  const upstream=await fetch(source.toString(),{
   headers:{Accept:"application/fits, application/octet-stream"},
   signal:AbortSignal.timeout(90000)
  });
  if(!upstream.ok){
   const retryable=[429,500,502,503,504].includes(upstream.status);
   return json({
    error:"The original SPHEREx FITS product could not be retrieved.",
    detail:"IRSA returned HTTP "+upstream.status+". "+(retryable?"The archive may be temporarily busy; retry in a little while.":"Check the original archive product link."),
    retryable
   },upstream.status===503?503:502,{"Retry-After":"30"});
  }
  const contentLength=Number(upstream.headers.get("content-length")||0);
  if(contentLength>100*1024*1024)return json({error:"This original FITS product is larger than the 100 MB browser-preview limit.",detail:"Open the original FITS product directly or choose a smaller observation product."},413);
  if(!upstream.body)return json({error:"IRSA returned an empty FITS product."},502);
  return new Response(upstream.body,{status:200,headers:{
   "Content-Type":"application/fits",
   ...(contentLength?{"Content-Length":String(contentLength)}:{}),
   "Cache-Control":"public, max-age=3600",
   "Content-Disposition":'inline; filename="spherex-original.fits"'
  }});
 }catch(error){
  const timedOut=error?.name==="TimeoutError";
  return json({error:"Could not retrieve the original SPHEREx FITS product.",detail:timedOut?"The full FITS download took too long. Try again or open the original product directly.":(error?.message||"Unknown error."),retryable:true},502,{"Retry-After":"30"});
 }
}
