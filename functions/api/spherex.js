// Cloudflare Pages Function: GET /api/spherex
// Use IRSA's documented SPHEREx SIA2 image-search interface. Query one
// release at a time so a temporary failure in one does not hide the other.
function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store"
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
  const host="https://irsa.ipac.caltech.edu";
  let lastError="No response from IRSA";
  // Try the fast SIA2 service first. If its gateway is unavailable,
  // fall back to the official TAP query demonstrated in IRSA's SPHEREx tutorial.
  try{
    const response=await fetch(host+"/SIA?"+params.toString(),{
      headers:{Accept:"application/x-votable+xml, application/xml, text/xml"},
      signal:AbortSignal.timeout(5000)
    });
    const xml=await response.text();
    if(response.ok && /<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml) &&
       !/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["']/i.test(xml)){
      return {collection,period:range?.label||null,xml,archiveHost:host,source:"SIA2"};
    }
    lastError=host+" SIA2 returned HTTP "+response.status;
  }catch(error){
    lastError=error?.name==="TimeoutError"?"IRSA SIA2 timed out":(error?.message||"IRSA SIA2 failed");
  }

  const releasePath=collection==="spherex_dr1"?"/dr1/":"/qr3/";
  const timeClause=range
    ?" AND (p.time_bounds_lower <= "+range.end+" AND p.time_bounds_upper >= "+range.start+")"
    :"";
  const tapQuery="SELECT DISTINCT TOP "+maxrec+" 'https://irsa.ipac.caltech.edu/' || a.uri AS access_url, "+
    "p.time_bounds_lower AS t_min, p.time_bounds_upper AS t_max, a.planeid AS obs_id, p.energy_bandpassname AS band "+
    "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "+
    "WHERE 1 = CONTAINS(POINT('ICRS', "+ra+", "+dec+"), p.poly) "+
    "AND a.uri LIKE '%"+releasePath+"%'"+timeClause+
    " ORDER BY p.time_bounds_lower";
  const body=new URLSearchParams({REQUEST:"doQuery",LANG:"ADQL",FORMAT:"votable",QUERY:tapQuery});
  const tap=await fetch(host+"/TAP/sync",{
    method:"POST",
    headers:{
      "Content-Type":"application/x-www-form-urlencoded",
      "Accept":"application/x-votable+xml, application/xml, text/xml"
    },
    body,
    signal:AbortSignal.timeout(20000)
  });
  const tapXml=await tap.text();
  if(!tap.ok) throw new Error(lastError+"; TAP fallback returned HTTP "+tap.status);
  if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(tapXml))
    throw new Error(lastError+"; TAP fallback returned an unexpected response");
  const tapError=tapXml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
  if(tapError) throw new Error(tapError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400)||"IRSA TAP rejected the fallback query");
  return {collection,period:range?.label||null,xml:tapXml,archiveHost:host,source:"TAP fallback"};
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
