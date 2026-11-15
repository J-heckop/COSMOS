// Cloudflare Pages Function: GET /api/spherex
// Search SPHEREx observation metadata through IRSA TAP. TAP is the documented
// alternative metadata-query path; image products are still fetched on demand.
function json(body,status=200,extra={}) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":status===200?"public, max-age=30, s-maxage=300, stale-while-revalidate=600":"no-store",
      ...extra
    }
  });
}

export async function onRequest({request}) {
  if(request.method!=="GET") return json({error:"Use GET for archive searches."},405,{Allow:"GET"});
  const q=new URL(request.url).searchParams;
  const ra=Number(q.get("ra")),dec=Number(q.get("dec")),radius=Number(q.get("radius"));
  if(!Number.isFinite(ra)||ra<0||ra>360||!Number.isFinite(dec)||dec< -90||dec>90||!Number.isFinite(radius)||radius<=0||radius>1)
    return json({error:"Invalid sky position or search radius."},400);
  const parsed=Number.parseInt(q.get("maxrec")||"100",10);
  const maxrec=Number.isFinite(parsed)?Math.min(5000,Math.max(1,parsed)):100;
  const collection=String(q.get("collection")||"spherex_qr3").toLowerCase();
  if(!["spherex_qr3","spherex_dr1","both"].includes(collection))
    return json({error:"Choose DR1, QR3, or both SPHEREx collections."},400);

  const ranges=[];
  const hasA=q.has("startA")||q.has("endA")||q.has("start")||q.has("end");
  const hasB=q.has("startB")||q.has("endB");
  if(hasA){
    const start=Number(q.has("startA")?q.get("startA"):q.get("start"));
    const end=Number(q.has("endA")?q.get("endA"):q.get("end"));
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<=0||end<start)
      return json({error:"Invalid Period A observation time range."},400);
    ranges.push({label:"A",start,end});
  }
  if(hasB){
    const start=Number(q.get("startB")),end=Number(q.get("endB"));
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<=0||end<start)
      return json({error:"Invalid Period B observation time range."},400);
    ranges.push({label:"B",start,end});
  }

  const dateOnly=ranges.length===0;
  const requestedRanges=dateOnly?[{label:null,start:null,end:null}]:ranges;
  const size=Math.max(0.01,Math.min(2,radius*2));
  const center=ra+","+dec;
  const jobs=await Promise.allSettled(requestedRanges.map(async range=>{
    const timeFilter=range
      ?" AND p.time_bounds_lower <= "+range.end+" AND p.time_bounds_upper >= "+range.start
      :"";
    // This spatial predicate and the artifact/plane join follow IRSA's
    // published SPHEREx TAP cutout example.
    const query=
      "SELECT TOP "+maxrec+" "+
      "'https://irsa.ipac.caltech.edu/' || a.uri || '?center="+center+"&size="+size+"' AS access_url, "+
      "p.time_bounds_lower AS t_min, p.time_bounds_upper AS t_max, "+
      "a.uri AS obs_id, p.energy_bandpassname AS band "+
      "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "+
      "WHERE CONTAINS(POINT('ICRS', "+ra+", "+dec+"), p.poly) = 1"+
      timeFilter+
      " ORDER BY p.time_bounds_lower";
    const params=new URLSearchParams({
      REQUEST:"doQuery",
      LANG:"ADQL",
      QUERY:query,
      FORMAT:"votable",
      MAXREC:String(maxrec)
    });
    const response=await fetch("https://irsa.ipac.caltech.edu/TAP/sync",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8","Accept":"application/x-votable+xml, application/xml, text/xml"},
      body:params.toString(),
      signal:AbortSignal.timeout(22000)
    });
    const xml=await response.text();
    if(!response.ok) throw new Error("IRSA TAP returned HTTP "+response.status+": "+xml.slice(0,300).replace(/<[^>]*>/g," ").trim());
    const queryError=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
    if(queryError){
      const detail=queryError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,500);
      throw new Error(detail||"IRSA TAP rejected the query.");
    }
    if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml))
      throw new Error("IRSA TAP returned an unexpected response.");
    return {collection:"spherex_tap",period:range.label,xml};
  }));

  const results=jobs.filter(x=>x.status==="fulfilled").map(x=>x.value);
  const errors=jobs.map((x,i)=>x.status==="rejected"
    ?{period:requestedRanges[i].label,error:x.reason?.name==="TimeoutError"?"IRSA TAP request timed out":x.reason?.message||"Archive query failed."}
    :null).filter(Boolean);
  if(!results.length){
    return json({
      error:"The SPHEREx metadata query could not be completed.",
      detail:errors.map(x=>(x.period?"Period "+x.period+": ":"")+x.error).join("; "),
      errors,source:"IRSA TAP",mode:dateOnly?"dates":"products"
    },502);
  }
  return json({
    results,errors,source:"IRSA TAP",mode:dateOnly?"dates":"products",
    partial:errors.length>0,collections:["spherex_dr1","spherex_qr3"]
  });
}
