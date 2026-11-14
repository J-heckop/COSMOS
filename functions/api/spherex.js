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
    const releasePath=selected==="spherex_dr1"?"/dr1/":"/qr3/";
    // Date discovery needs one row per UTC day, not thousands of image planes.
    // Full product URLs and plane metadata are returned only for comparisons.
    // Use the observation table to filter releases. Date discovery does not
    // need the artifact table, so avoid joining every image product just to
    // obtain a list of distinct observation days.
    const select=dateOnly
      ?"SELECT DISTINCT TOP "+maxrec+" FLOOR(p.time_bounds_lower) AS t_min "
      :"SELECT DISTINCT TOP "+maxrec+" 'https://irsa.ipac.caltech.edu/' || a.uri AS access_url, "+
       "p.time_bounds_lower AS t_min, p.time_bounds_upper AS t_max, a.planeid AS obs_id, p.energy_bandpassname AS band ";
    const from=dateOnly
      ?"FROM spherex.plane p JOIN spherex.observation o ON o.obsid = p.obsid "
      :"FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid JOIN spherex.observation o ON o.obsid = p.obsid ";
    const orderBy=dateOnly?" ORDER BY FLOOR(p.time_bounds_lower)":" ORDER BY p.time_bounds_lower";
    const query=select+from+
      "WHERE 1 = CONTAINS(POINT('ICRS', "+ra+", "+dec+"), p.poly) "+
      "AND o.collection = '"+selected+"'"+timeClause+orderBy;
    const body=new URLSearchParams({REQUEST:"doQuery",LANG:"ADQL",FORMAT:"votable",QUERY:query});
    const response=await fetch("https://irsa.ipac.caltech.edu/TAP/sync",{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "Accept":"application/x-votable+xml, application/xml, text/xml"
      },
      body,
      signal:AbortSignal.timeout(55000)
    });
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
