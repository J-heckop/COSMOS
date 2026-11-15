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

async function queryTapFallback({ra,dec,radius,collection,maxrec,band}){
  const bandFilter=band&&band!=="all"
    ? " AND p.energy_bandpassname = '"+String(band).replace(/[^A-Za-z0-9_-]/g,"")+"'"
    : "";
  const adql=`SELECT TOP ${maxrec}
    '${"https://irsa.ipac.caltech.edu/"}' || a.uri || '?center=${ra},${dec}d&size=${radius}' AS access_url,
    p.time_bounds_lower AS t_min,
    p.time_bounds_upper AS t_max,
    p.energy_bandpassname AS band,
    p.planeid AS obs_id
  FROM spherex.artifact a
  JOIN spherex.plane p ON a.planeid = p.planeid
  JOIN spherex.observation o ON o.obsid = p.obsid
  WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)
    AND o.collection = '${collection}'${bandFilter}
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
    signal:AbortSignal.timeout(45000)
  });
  const xml=await response.text();
  if(!response.ok) throw new Error("IRSA TAP fallback returned HTTP "+response.status+": "+xml.slice(0,250).replace(/<[^>]*>/g," ").trim());
  if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\\b/i.test(xml))
    throw new Error("IRSA TAP fallback returned an unexpected response.");
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
    const url=new URL("https://irsa.ipac.caltech.edu/SIA");
    url.search=new URLSearchParams({
      COLLECTION:task.name,
      POS:"CIRCLE "+ra+" "+dec+" "+radius,
      MAXREC:String(maxrec)
    }).toString();
    // Cache successful collection responses at the edge so repeat searches
    // for the same sky position do not need another IRSA round-trip.
    const cache=typeof caches!=="undefined"&&caches.default?caches.default:null;
    // Cloudflare Cache API keys must be on this site's zone. Use a synthetic
    // same-origin key while preserving the complete upstream query string.
    const cacheUrl=new URL("/__cosmos-cache/spherex",request.url);
    cacheUrl.search=url.search;
    const cacheKey=new Request(cacheUrl.toString(),{method:"GET"});
    let xml=null;
    if(cache){
      try{
        const cached=await cache.match(cacheKey);
        if(cached) xml=await cached.text();
      }catch(_){}
    }
    if(xml===null){
      let response;
      // Retry transient gateway responses with short exponential backoff.
      let siaFailure=null;
      for(let attempt=0;attempt<3;attempt++){
        try{
          response=await fetch(url.toString(),{
            signal:AbortSignal.timeout(25000)
          });
          xml=await response.text();
          if(response.ok) break;
          siaFailure=new Error("IRSA SIA2 returned HTTP "+response.status+": "+xml.slice(0,300).replace(/<[^>]*>/g," ").trim());
          if(![502,503,504].includes(response.status)||attempt===2) break;
        }catch(error){
          siaFailure=error;
          if(attempt===2) break;
        }
        await new Promise(resolve=>setTimeout(resolve,500*Math.pow(2,attempt)));
      }
      if(!response?.ok){
        try{
          xml=await queryTapFallback({ra,dec,radius,collection:task.name,maxrec,band});
        }catch(tapError){
          throw new Error((siaFailure?.message||"IRSA SIA2 failed.")+"; TAP fallback: "+tapError.message);
        }
      }
    }
    const queryError=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
    if(queryError) throw new Error(queryError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400)||"IRSA SIA2 rejected the query.");
    if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml))
      throw new Error("IRSA SIA2 returned an unexpected response.");
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
    return {collection:task.name,period:null,xml};
  }));

  const results=jobs.filter(x=>x.status==="fulfilled").map(x=>x.value);
  const errors=jobs.map((x,i)=>x.status==="rejected"
    ?{collection:tasks[i].name,error:x.reason?.name==="TimeoutError"?"IRSA SIA2 request timed out":x.reason?.message||"Archive query failed."}
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
