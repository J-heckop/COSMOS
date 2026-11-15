// Cloudflare Pages Function: GET /api/spherex
// Discover SPHEREx observation dates through IRSA's documented asynchronous TAP API.
// TAP is used here because it can query the archive tables directly and avoids
// relying on the SIA2 service when that endpoint is returning transient 502s.
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
const TAP="https://irsa.ipac.caltech.edu/TAP";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function readText(url,options={},timeout=10000) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(timeout)});
  const text=await response.text();
  if(!response.ok) throw new Error("IRSA TAP returned HTTP "+response.status+(text?" · "+text.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,220):""));
  return {response,text};
}
function validateVOTable(xml) {
  const queryError=xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
  if(queryError) throw new Error(queryError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,350)||"IRSA TAP rejected the query.");
  if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml)) throw new Error("IRSA TAP returned an unexpected response.");
}
async function queryCollection(selected,ra,dec,radius,maxrec) {
  // The observation table identifies the selected public release. The plane
  // table supplies the sky footprint and observation time bounds.
  const query=
    "SELECT DISTINCT TOP "+maxrec+" FLOOR(p.time_bounds_lower) AS t_min "+
    "FROM spherex.plane AS p JOIN spherex.observation AS o ON o.obsid = p.obsid "+
    "WHERE o.collection = '"+selected+"' "+
    "AND 1 = CONTAINS(POINT('ICRS', "+ra+", "+dec+"), p.poly) "+
    "AND p.time_bounds_lower IS NOT NULL "+
    "ORDER BY FLOOR(p.time_bounds_lower)";
  // IRSA's own TAP examples submit asynchronous jobs as a GET request
  // with QUERY and FORMAT in the URL. Use that documented form rather than
  // POSTing a form body, which can be rejected by the archive gateway.
  const submitUrl=new URL(TAP+"/async");
  submitUrl.search=new URLSearchParams({REQUEST:"doQuery",LANG:"ADQL",FORMAT:"votable",QUERY:query}).toString();
  const submitted=await fetch(submitUrl.toString(),{
    method:"GET",headers:{"Accept":"application/xml,text/xml"},
    redirect:"manual",signal:AbortSignal.timeout(18000)
  });
  const location=submitted.headers.get("location");
  if(![200,201,303,302].includes(submitted.status)||!location) {
    const detail=(await submitted.text()).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,250);
    throw new Error("IRSA TAP could not create an async query job (HTTP "+submitted.status+")"+(detail?": "+detail:""));
  }
  const jobUrl=new URL(location,TAP+"/").toString().replace(/\/$/,"");
  // Start the queued UWS job.
  const started=await fetch(jobUrl+"/phase",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:"PHASE=RUN",redirect:"manual",signal:AbortSignal.timeout(10000)
  });
  if(!started.ok&&started.status!==303) {
    const detail=(await started.text()).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,200);
    throw new Error("IRSA TAP could not start the query job (HTTP "+started.status+")"+(detail?": "+detail:""));
  }
  // Poll the lightweight phase resource for up to ~45 seconds.
  const deadline=Date.now()+45000;
  let phase="";
  while(Date.now()<deadline) {
    const state=await readText(jobUrl+"/phase",{headers:{Accept:"text/plain"}},9000);
    phase=state.text.trim().toUpperCase();
    if(phase==="COMPLETED") break;
    if(["ERROR","ABORTED","ABORT"].includes(phase)) {
      let detail="";
      try{detail=(await readText(jobUrl+"/error",{},5000)).text.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300)}catch{}
      throw new Error("IRSA TAP query job "+phase+(detail?": "+detail:""));
    }
    if(!["PENDING","QUEUED","EXECUTING","SUSPENDED"].includes(phase))
      throw new Error("IRSA TAP returned an unknown query-job state: "+phase);
    await sleep(1500);
  }
  if(phase!=="COMPLETED") throw new Error("IRSA TAP query is still running after 45 seconds. Retry the date search shortly.");
  const result=await readText(jobUrl+"/results/result",{headers:{Accept:"application/x-votable+xml, application/xml, text/xml"}},12000);
  validateVOTable(result.text);
  return {collection:selected,period:null,xml:result.text};
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
  const settled=await Promise.allSettled(collections.map(name=>queryCollection(name,ra,dec,radius,maxrec)));
  const results=settled.filter(item=>item.status==="fulfilled").map(item=>item.value);
  const errors=settled.map((item,index)=>item.status==="rejected"
    ?{collection:collections[index],error:item.reason?.message||"Archive query failed."}:null).filter(Boolean);
  if(!results.length) return json({
    error:"The SPHEREx date catalogue could not be queried.",
    detail:errors.map(item=>item.collection+": "+item.error).join("; "),
    errors,source:"IRSA TAP async",mode:"dates"
  },502);
  return json({results,errors,source:"IRSA TAP async",mode:"dates",partial:errors.length>0,collections});
}
