// Cloudflare Pages Function: GET /api/spherex
// Use IRSA's documented SPHEREx SIA2 image-search interface. Query one
// release at a time so a temporary failure in one does not hide the other.
function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":status===200?"public, max-age=30, s-maxage=180, stale-while-revalidate=300":"no-store"
    }
  });
}
const IRSA="https://irsa.ipac.caltech.edu";
async function queryCollection(collection,ra,dec,radius,range,maxrec){
  const params=new URLSearchParams({
    COLLECTION:collection,
    POS:"circle "+ra+" "+dec+" "+radius,
    MAXREC:String(maxrec),
    RESPONSEFORMAT:"VOTABLE"
  });
  if(range) params.set("TIME",range.start+" "+range.end);
  const hosts=["https://irsa.ipac.caltech.edu"];
  let lastError="No response from IRSA";
  // Use IRSA's documented SPHEREx SIA2 endpoint.
  for(const host of hosts){
    try{
      const response=await fetch(host+"/SIA?"+params.toString(),{
        headers:{Accept:"application/x-votable+xml, application/xml, text/xml"},
        signal:AbortSignal.timeout(10000)
      });
      const xml=await response.text();
      if(!response.ok){
        lastError=host+" returned HTTP "+response.status;
        continue;
      }
      if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml)){
        lastError=host+" returned a non-VOTable response";
        continue;
      }
      const error=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
      if(error){
        lastError=error[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400)||"IRSA rejected the image query";
        continue;
      }
      return {collection,period:range?.label||null,xml,archiveHost:host};
    }catch(error){
      lastError=error?.name==="TimeoutError"?host+" timed out":(error?.message||"IRSA request failed");
    }
  }
  throw new Error(lastError);
}
export async function onRequest({request}){
  if(request.method!=="GET") return json({error:"Use GET for archive searches."},405);
  const q=new URL(request.url).searchParams;
  const ra=Number(q.get("ra")),dec=Number(q.get("dec")),radius=Number(q.get("radius"));
  if(!Number.isFinite(ra)||ra<0||ra>360||!Number.isFinite(dec)||dec< -90||dec>90||!Number.isFinite(radius)||radius<=0||radius>1)
    return json({error:"Invalid sky position or search radius."},400);
  const maxrecRaw=Number(q.get("maxrec")||150);
  const maxrec=Number.isFinite(maxrecRaw)?Math.max(1,Math.min(150,Math.floor(maxrecRaw))):150;
  const requestedBand=String(q.get("band")||"SPHEREx-D2");
  if(requestedBand!=="all"&&!/^SPHEREx-D[1-6]$/.test(requestedBand))
    return json({error:"Choose a valid SPHEREx spectral band."},400);
  const ranges=[];
  const hasA=q.has("startA")||q.has("endA")||q.has("start")||q.has("end");
  const hasB=q.has("startB")||q.has("endB");
  if(hasA){
    const start=Number(q.has("startA")?q.get("startA"):q.get("start"));
    const end=Number(q.has("endA")?q.get("endA"):q.get("end"));
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<=0||end<start)return json({error:"Invalid Period A observation time range."},400);
    ranges.push({label:"A",start,end});
  }
  if(hasB){
    const start=Number(q.get("startB")),end=Number(q.get("endB"));
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<=0||end<start)return json({error:"Invalid Period B observation time range."},400);
    ranges.push({label:"B",start,end});
  }
  const requestedRanges=ranges.length?ranges:[null];
  const results=[],errors=[];
  // Query releases in parallel so the browser does not time out while
  // waiting for one slow collection. Each collection has its own host fallback.
  const jobs=["spherex_qr3","spherex_dr1"].flatMap(collection=>
    requestedRanges.map(range=>({collection,range}))
  );
  const settled=await Promise.allSettled(jobs.map(job=>
    queryCollection(job.collection,ra,dec,radius,job.range,maxrec)
  ));
  settled.forEach((item,index)=>{
    const job=jobs[index];
    if(item.status==="fulfilled") results.push(item.value);
    else errors.push({collection:job.collection,period:job.range?.label||null,error:item.reason?.message||"Archive query failed"});
  });
  if(!results.length){
    return json({
      error:"IRSA's SPHEREx image-search service did not return a usable response.",
      detail:errors.map(x=>x.collection+(x.period?" period "+x.period:"")+": "+x.error).join("; "),
      errors,source:"IRSA SIA2",mode:ranges.length?"comparison":"observations"
    },502);
  }
  return json({
    done:true,results,errors,source:"IRSA SIA2",
    partial:errors.length>0,band:requestedBand,
    note:"SIA2 returns released image metadata filtered by sky position; spectral-band selection is applied to returned wavelength metadata in COSMOS."
  });
}
