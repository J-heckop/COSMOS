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

async function querySiaFallback({ra,dec,radius,collection,maxrec}){
  // SIA2 is IRSA's documented image-discovery API and provides t_min,
  // t_max, and access_url fields used by COSMOS' date picker and image viewer.
  const params=new URLSearchParams({
    COLLECTION:collection,
    POS:`circle ${ra} ${dec} ${radius}`,
    MAXREC:String(maxrec),
    RESPONSEFORMAT:"VOTABLE"
  });
  const response=await fetch("https://irsa.ipac.caltech.edu/SIA?"+params.toString(),{
    method:"GET",
    headers:{Accept:"application/x-votable+xml, application/xml;q=0.9"},
    signal:AbortSignal.timeout(10000)
  });
  const xml=await response.text();
  if(!response.ok) throw new Error("IRSA SIA2 returned HTTP "+response.status+": "+xml.slice(0,250).replace(/<[^>]*>/g," ").trim());
  if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml))
    throw new Error("IRSA SIA2 returned an unexpected response.");
  const queryError=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
  if(queryError) throw new Error(queryError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300)||"IRSA SIA2 rejected the query.");
  return xml;
}

async function queryTapFallback({ra,dec,radius,collection,maxrec,band}){
  const bandFilter=band&&band!=="all"
    ? " AND p.energy_bandpassname = '"+String(band).replace(/[^A-Za-z0-9_-]/g,"")+"'"
    : "";
  // Follow IRSA's published SPHEREx TAP example: artifact + plane.
  // Filter the release using the documented artifact URI path instead of
  // relying on an extra observation-table join.
  const release=collection==="spherex_dr1"?"dr1":"qr3";
  const adql=`SELECT TOP ${maxrec}
    'https://irsa.ipac.caltech.edu/' || a.uri || '?center=${ra},${dec}d&size=${radius}' AS access_url,
    p.time_bounds_lower AS t_min,
    p.time_bounds_upper AS t_max,
    p.energy_bandpassname AS band,
    p.planeid AS obs_id
  FROM spherex.artifact a
  JOIN spherex.plane p ON a.planeid = p.planeid
  WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)
    AND a.uri LIKE '%/${release}/%'
    ${bandFilter}
  ORDER BY p.time_bounds_lower`;
  const body=new URLSearchParams({
    REQUEST:"doQuery",
    LANG:"ADQL",
    FORMAT:"votable",
    QUERY:adql
  });
  const response=await fetch("https://irsa.ipac.caltech.edu/TAP/sync",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
    body:body.toString(),
    signal:AbortSignal.timeout(10000)
  });
  const xml=await response.text();
  if(!response.ok) throw new Error("IRSA TAP returned HTTP "+response.status+": "+xml.slice(0,300).replace(/<[^>]*>/g," ").trim());
  if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml))
    throw new Error("IRSA TAP returned an unexpected response.");
  const queryError=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
  if(queryError) throw new Error(queryError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400)||"IRSA TAP rejected the query.");
  return xml;
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
  const band=String(q.get("band")||"all");
  const collections=collection==="both"?["spherex_dr1","spherex_qr3"]:[collection];
  if(!collections.every(name=>["spherex_qr3","spherex_dr1"].includes(name)))
    return json({error:"Choose DR1, QR3, or both SPHEREx collections."},400);

  // Keep every archive call on the original working spatial-query path.
  // Comparison date selection is applied to returned observation times in the browser.
  const tasks=collections.map(name=>({name}));
  const jobs=await Promise.allSettled(tasks.map(async task=>{
    // Use IRSA's documented TAP metadata query as the primary source.
    // TAP exposes newly ingested SPHEREx records before SIA2 catches up.
    const cache=typeof caches!=="undefined"&&caches.default?caches.default:null;
    const cacheUrl=new URL("/__cosmos-cache/spherex",request.url);
    cacheUrl.search=new URLSearchParams({
      collection:task.name,ra:String(ra),dec:String(dec),radius:String(radius),
      maxrec:String(maxrec),band
    }).toString();
    const cacheKey=new Request(cacheUrl.toString(),{method:"GET"});
    let xml=null;
    if(cache){
      try{
        const cached=await cache.match(cacheKey);
        if(cached) xml=await cached.text();
      }catch(_){}
    }
    let source="IRSA SIA2";
    if(xml===null){
      try{
        // SIA2 is purpose-built for spatial image discovery. Try it first;
        // TAP's polygon join is retained only as a fallback.
        xml=await querySiaFallback({ra,dec,radius,collection:task.name,maxrec});
      }catch(siaError){
        source="IRSA TAP";
        xml=await queryTapFallback({ra,dec,radius,collection:task.name,maxrec,band});
      }
      if(cache){
        try{
          await cache.put(cacheKey,new Response(xml,{
            headers:{
              "Content-Type":"application/x-votable+xml; charset=utf-8",
              "Cache-Control":"public, max-age=600"
            }
          }));
        }catch(_){}
      }
    }
    
    return {collection:task.name,period:null,xml,source};
  }));

  const results=jobs.filter(x=>x.status==="fulfilled").map(x=>x.value);
  const errors=jobs.map((x,i)=>x.status==="rejected"
    ?{collection:tasks[i].name,error:x.reason?.name==="TimeoutError"?"IRSA archive request timed out":x.reason?.message||"Archive query failed."}
    :null).filter(Boolean);
  if(!results.length){
    return json({
      error:"The SPHEREx metadata query could not be completed.",
      detail:errors.map(x=>x.collection+": "+x.error).join("; "),
      errors,source:"IRSA TAP/SIA2",mode:"dates"
    },502);
  }
  return json({
    results,errors,source:"IRSA TAP/SIA2",mode:"dates",
    partial:errors.length>0,collections
  });
}
