// Cloudflare Pages Function: GET /api/spherex
// Search official SPHEREx observation metadata through IRSA's documented SIA2 API.
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
  const raText=q.get("ra"),decText=q.get("dec"),radiusText=q.get("radius");
  if(raText===null||decText===null||radiusText===null||!raText.trim()||!decText.trim()||!radiusText.trim())
    return json({error:"Enter RA, Dec, and search radius before searching the SPHEREx archive."},400);
  const ra=Number(raText),dec=Number(decText),radius=Number(radiusText);
  if(!Number.isFinite(ra)||ra<0||ra>360||!Number.isFinite(dec)||dec< -90||dec>90||!Number.isFinite(radius)||radius<=0||radius>1)
    return json({error:"Invalid sky position or search radius."},400);
  const parsed=Number.parseInt(q.get("maxrec")||"150",10);
  const maxrec=Number.isFinite(parsed)?Math.min(5000,Math.max(1,parsed)):150;
  const collection=String(q.get("collection")||"both").toLowerCase();
  const collections=collection==="both"?["spherex_dr1","spherex_qr3"]:[collection];
  if(!collections.every(name=>["spherex_qr3","spherex_dr1"].includes(name)))
    return json({error:"Choose DR1, QR3, or both SPHEREx collections."},400);

  const jobs=await Promise.allSettled(collections.map(async name=>{
    const url=new URL("https://irsa.ipac.caltech.edu/SIA");
    url.search=new URLSearchParams({
      COLLECTION:name,
      POS:"CIRCLE "+ra+" "+dec+" "+radius,
      MAXREC:String(maxrec)
    }).toString();
    const response=await fetch(url.toString(),{
      signal:AbortSignal.timeout(25000)
    });
    const xml=await response.text();
    if(!response.ok) throw new Error("IRSA SIA2 returned HTTP "+response.status+": "+xml.slice(0,300).replace(/<[^>]*>/g," ").trim());
    const queryError=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
    if(queryError) throw new Error(queryError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400)||"IRSA SIA2 rejected the query.");
    if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml))
      throw new Error("IRSA SIA2 returned an unexpected response.");
    return {collection:name,period:null,xml};
  }));

  const results=jobs.filter(x=>x.status==="fulfilled").map(x=>x.value);
  const errors=jobs.map((x,i)=>x.status==="rejected"
    ?{collection:collections[i],error:x.reason?.name==="TimeoutError"?"IRSA SIA2 request timed out":x.reason?.message||"Archive query failed."}
    :null).filter(Boolean);
  if(!results.length){
    return json({
      error:"The SPHEREx metadata query could not be completed.",
      detail:errors.map(x=>x.collection+": "+x.error).join("; "),
      errors,source:"IRSA SIA2",mode:"dates"
    },502);
  }
  return json({
    results,errors,source:"IRSA SIA2",mode:"dates",
    partial:errors.length>0,collections
  });
}
