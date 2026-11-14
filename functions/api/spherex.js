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
    let response;
    if(dateOnly){
      // SIA2 is IRSA's purpose-built spatial image search. Use it for date
      // discovery instead of scanning/joining TAP metadata tables.
      const params=new URLSearchParams({
        COLLECTION:selected,
        POS:"CIRCLE "+ra+" "+dec+" "+radius,
        MAXREC:String(maxrec),
        RESPONSEFORMAT:"VOTABLE"
      });
      response=await fetch("https://irsa.ipac.caltech.edu/SIA?"+params.toString(),{
        headers:{"Accept":"application/x-votable+xml, application/xml, text/xml"},
        signal:AbortSignal.timeout(22000)
      });
    }else{
      // TAP remains the source for the selected-date product metadata.
      const query="SELECT DISTINCT TOP "+maxrec+" 'https://irsa.ipac.caltech.edu/' || a.uri AS access_url, "+
        "p.time_bounds_lower AS t_min, p.time_bounds_upper AS t_max, a.planeid AS obs_id, p.energy_bandpassname AS band "+
        "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "+
        "WHERE 1 = CONTAINS(POINT('ICRS', "+ra+", "+dec+"), p.poly)"+timeClause+
        " ORDER BY p.time_bounds_lower";
      const body=new URLSearchParams({REQUEST:"doQuery",LANG:"ADQL",FORMAT:"votable",QUERY:query});
      response=await fetch("https://irsa.ipac.caltech.edu/TAP/sync",{
        method:"POST",
        headers:{
          "Content-Type":"application/x-www-form-urlencoded",
          "Accept":"application/x-votable+xml, application/xml, text/xml"
        },
        body,
        signal:AbortSignal.timeout(40000)
      });
    }
    const xml=await response.text();
    if(!response.ok)throw new Error("IRSA TAP returned HTTP "+response.status);
    const queryError=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
    if(queryError){
      const detail=queryError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400);
      throw new Error(detail||"IRSA TAP rejected the query.");
    }
    if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml))
      throw new Error("IRSA TAP returned an unexpected response.");
    return {collection:selected,period:null,xml};
  }

  const settled=await Promise.allSettled(collections.map(queryCollection));
  const results=settled.filter(item=>item.status==="fulfilled").map(item=>item.value);
  const errors=settled.map((item,index)=>item.status==="rejected"
    ?{collection:collections[index],error:item.reason?.message||"Archive query failed."}
    :null).filter(Boolean);

  if(!results.length){
    return json({
      error:"No SPHEREx collection could be queried.",
      detail:errors.map(item=>item.collection+": "+item.error).join("; "),
      errors,
      source:"IRSA TAP",
      mode:dateOnly?"dates":"products"
    },502);
  }
  return json({
    results,
    errors,
    source:"IRSA TAP",
    mode:dateOnly?"dates":"products",
    partial:errors.length>0,
    collections
  });
}
