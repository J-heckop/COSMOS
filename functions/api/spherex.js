// Cloudflare Pages Function: GET /api/spherex
// Uses a lightweight date-only query for discovery and fetches full products
// only when the user selects dates to compare.
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
  const parsed=Number.parseInt(q.get("maxrec")||"10",10);
  const maxrec=Number.isFinite(parsed)?Math.min(5000,Math.max(1,parsed)):10;
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
  const timeClause=ranges.length
    ?" AND ("+ranges.map(x=>"(p.time_bounds_lower <= "+x.end+" AND p.time_bounds_upper >= "+x.start+")").join(" OR ")+")"
    :"";
  const collections=collection==="both"?["spherex_dr1","spherex_qr3"]:[collection];

  async function queryCollection(selected){
    // SIA2 is optimized for spatial + time-constrained image searches.
    // Query each selected date separately so the archive never scans a broad
    // catalogue range just to return two comparison periods.
    const requestedRanges=dateOnly?[{label:null,start:null,end:null}]:ranges;
    const responses=await Promise.all(requestedRanges.map(async range=>{
      const params=new URLSearchParams({
        COLLECTION:selected,
        POS:"CIRCLE "+ra+" "+dec+" "+radius,
        DPTYPE:"image",
        MAXREC:String(dateOnly?maxrec:30),
        RESPONSEFORMAT:"VOTABLE"
      });
      if(range && Number.isFinite(range.start) && Number.isFinite(range.end)) params.set("TIME",range.start+" "+range.end);
      const response=await fetch("https://irsa.ipac.caltech.edu/SIA?"+params.toString(),{
        headers:{"Accept":"application/x-votable+xml, application/xml, text/xml"},
        signal:AbortSignal.timeout(18000)
      });
      const xml=await response.text();
      if(!response.ok) throw new Error("IRSA SIA2 returned HTTP "+response.status);
      const queryError=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
      if(queryError){
        const detail=queryError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400);
        throw new Error(detail||"IRSA SIA2 rejected the query.");
      }
      if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml))
        throw new Error("IRSA SIA2 returned an unexpected response.");
      return {collection:selected,period:range?.label||null,xml};
    }));
    return responses;
  }

  const settled=await Promise.allSettled(collections.map(queryCollection));
  const results=settled.filter(item=>item.status==="fulfilled").flatMap(item=>item.value);
  const errors=settled.map((item,index)=>item.status==="rejected"
    ?{collection:collections[index],error:item.reason?.message||"Archive query failed."}
    :null).filter(Boolean);

  if(!results.length){
    return json({
      error:"No SPHEREx collection could be queried.",
      detail:errors.map(item=>item.collection+": "+item.error).join("; "),
      errors,
      source:"IRSA SIA2",
      mode:dateOnly?"dates":"products"
    },502);
  }
  return json({
    results,
    errors,
    source:"IRSA SIA2",
    mode:dateOnly?"dates":"products",
    partial:errors.length>0,
    collections
  });
}
