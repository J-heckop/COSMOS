// Cloudflare Pages Function: GET /api/spherex
// Uses IRSA asynchronous TAP jobs so long-running SPHEREx metadata searches
// continue on IRSA instead of holding a Cloudflare request open.
function json(body,status=200) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":status===200?"public, max-age=30, s-maxage=300, stale-while-revalidate=600":"no-store"
    }
  });
}
const IRSA="https://irsa.ipac.caltech.edu";
function errorFromXml(xml){
  const match=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
  return match?match[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,500):"";
}
async function pollJob(id){
  if(!/^\d+$/.test(id)) throw new Error("Invalid archive job ID.");
  const base=IRSA+"/TAP/async/"+id;
  const phaseResponse=await fetch(base+"/phase",{signal:AbortSignal.timeout(12000)});
  if(!phaseResponse.ok) throw new Error("IRSA job status returned HTTP "+phaseResponse.status);
  const phase=(await phaseResponse.text()).trim().toUpperCase();
  if(phase==="ERROR"||phase==="ABORT"){
    const detailResponse=await fetch(base+"/error",{signal:AbortSignal.timeout(8000)});
    const detail=detailResponse.ok?(await detailResponse.text()).slice(0,500):"";
    throw new Error(detail||"IRSA TAP job "+phase.toLowerCase()+".");
  }
  if(phase!=="COMPLETED") return {id,phase};
  const resultResponse=await fetch(base+"/results/result",{headers:{Accept:"application/x-votable+xml, application/xml, text/xml"},signal:AbortSignal.timeout(20000)});
  const xml=await resultResponse.text();
  if(!resultResponse.ok) throw new Error("IRSA result download returned HTTP "+resultResponse.status);
  const queryError=errorFromXml(xml);
  if(queryError) throw new Error(queryError);
  if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml)) throw new Error("IRSA returned an unexpected result format.");
  return {id,phase,xml};
}
export async function onRequest({request}) {
  if(request.method!=="GET") return json({error:"Use GET for archive searches."},405);
  const q=new URL(request.url).searchParams;

  // Poll an existing asynchronous TAP job.
  if(q.has("job")){
    try{
      const job=await pollJob(q.get("job"));
      if(job.xml) return json({done:true,phase:job.phase,results:[{collection:"spherex_tap",period:null,xml:job.xml}],source:"IRSA TAP async"});
      return json({done:false,phase:job.phase,jobId:job.id},202);
    }catch(error){return json({error:error.message||"Could not check the IRSA job."},502);}
  }

  const ra=Number(q.get("ra")),dec=Number(q.get("dec")),radius=Number(q.get("radius"));
  if(!Number.isFinite(ra)||ra<0||ra>360||!Number.isFinite(dec)||dec< -90||dec>90||!Number.isFinite(radius)||radius<=0||radius>1)
    return json({error:"Invalid sky position or search radius."},400);
  const maxrec=150;
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
  const bandFilter=requestedBand==="all"?"":" AND p.energy_bandpassname = '"+requestedBand+"'";
  const dateFilter=ranges.length
    ?" AND ("+ranges.map(x=>"(p.time_bounds_lower <= "+x.end+" AND p.time_bounds_upper >= "+x.start+")").join(" OR ")+")"
    :"";
  const size=Math.max(0.01,Math.min(2,radius*2));
  const center=ra+","+dec;
  const query=
    "SELECT TOP "+maxrec+" "+
    "'https://irsa.ipac.caltech.edu/' || a.uri || '?center="+center+"d&size="+size+"' AS access_url, "+
    "p.time_bounds_lower AS t_min, p.time_bounds_upper AS t_max, "+
    "a.uri AS obs_id, p.energy_bandpassname AS band "+
    "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "+
    "WHERE 1 = CONTAINS(POINT('ICRS', "+ra+", "+dec+"), p.poly)"+
    bandFilter+dateFilter+
    " ORDER BY p.time_bounds_lower";
  const params=new URLSearchParams({REQUEST:"doQuery",LANG:"ADQL",QUERY:query,FORMAT:"votable",MAXREC:String(maxrec)});
  try{
    const response=await fetch(IRSA+"/TAP/async",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8","Accept":"text/plain"},
      body:params.toString(),
      redirect:"manual",
      signal:AbortSignal.timeout(15000)
    });
    const location=response.headers.get("Location");
    let jobUrl=location;
    if(!jobUrl&&response.ok) jobUrl=(await response.text()).trim();
    if(!jobUrl) throw new Error("IRSA did not return an asynchronous job URL (HTTP "+response.status+").");
    const parsed=new URL(jobUrl,IRSA);
    if(parsed.origin!==IRSA||!/^\/TAP\/async\/\d+\/?$/.test(parsed.pathname))throw new Error("IRSA returned an invalid job URL.");
    const jobId=parsed.pathname.match(/\/(\d+)\/?$/)[1];
    const run=await fetch(IRSA+"/TAP/async/"+jobId+"/phase",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
      body:"PHASE=RUN",
      signal:AbortSignal.timeout(12000)
    });
    if(!run.ok&&run.status!==303)throw new Error("Could not start IRSA job (HTTP "+run.status+").");
    return json({done:false,phase:"QUEUED",jobId,source:"IRSA TAP async",band:requestedBand},202);
  }catch(error){
    return json({error:error.name==="TimeoutError"?"Could not start the IRSA background job in time.":error.message||"Could not start the IRSA archive search."},502);
  }
}
