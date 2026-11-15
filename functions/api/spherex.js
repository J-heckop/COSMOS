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

function parseCsv(text){
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','){row.push(cell);cell="";}
    else if(ch==="\n"){row.push(cell);rows.push(row);row=[];cell="";}
    else if(ch!=="\r")cell+=ch;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  return rows.filter(r=>r.some(v=>String(v).trim()!==""));
}
function csvAsVOTable(csv){
  const rows=parseCsv(csv.replace(/^\uFEFF/,""));
  if(rows.length<2)throw new Error("IRSA CSV response contained no observation rows.");
  const headers=rows.shift().map((h,i)=>String(h||("column_"+i)).trim());
  const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const fields=headers.map(name=>'<FIELD name="'+esc(name)+'" datatype="char" arraysize="*"/>').join("");
  const body=rows.map(values=>"<TR>"+headers.map((_,i)=>"<TD>"+esc(values[i]||"")+"</TD>").join("")+"</TR>").join("");
  return '<?xml version="1.0"?><VOTABLE><RESOURCE><TABLE>'+fields+'<DATA><TABLEDATA>'+body+'</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
}
const IRSA="https://irsa.ipac.caltech.edu";
async function queryCollection(collection,ra,dec,radius,range,maxrec){
  const host=IRSA;
  let lastError="No response from IRSA";
  // SIA2 officially supports both VOTABLE and CSV output. Try CSV as a
  // second representation if the VOTable renderer fails at the gateway.
  for(const format of ["VOTABLE","CSV"]){
    const params=new URLSearchParams({
      COLLECTION:collection,
      POS:"circle "+ra+" "+dec+" "+radius,
      MAXREC:String(maxrec),
      RESPONSEFORMAT:format
    });
    if(range)params.set("TIME",range.start+" "+range.end);
    for(let attempt=0;attempt<2;attempt++){
      try{
        const response=await fetch(host+"/SIA?"+params.toString(),{
          headers:{
            Accept:format==="CSV"?"text/csv, text/plain":"application/x-votable+xml, application/xml, text/xml",
            "User-Agent":"COSMOS-SPHEREx-Explorer/1.0"
          },
          signal:AbortSignal.timeout(15000)
        });
        const body=await response.text();
        if(response.ok){
          try{
            const xml=format==="VOTABLE"?body:csvAsVOTable(body);
            if(/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml) &&
               !/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["']/i.test(xml)){
              return {collection,period:range?.label||null,xml,archiveHost:host,source:"SIA2 "+format};
            }
            lastError="SIA2 "+format+" returned an invalid observation table";
          }catch(error){lastError="SIA2 "+format+": "+(error?.message||"invalid response");}
        }else{
          lastError="SIA2 "+format+" HTTP "+response.status+(body.trim()?" · "+body.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,160):"");
        }
        if(![429,500,502,503,504].includes(response.status))break;
      }catch(error){
        lastError=error?.name==="TimeoutError"?"IRSA SIA2 "+format+" timed out":(error?.message||"IRSA SIA2 failed");
        if(error?.name==="TimeoutError")break;
      }
      if(attempt===0)await new Promise(resolve=>setTimeout(resolve,650));
    }
  }

  const releasePath=collection==="spherex_dr1"?"/dr1/":"/qr3/";
  const timeClause=range
    ?" AND (p.time_bounds_lower <= "+range.end+" AND p.time_bounds_upper >= "+range.start+")"
    :"";
  const tapQuery="SELECT TOP "+maxrec+" "+
    "'https://irsa.ipac.caltech.edu/' || a.uri AS access_url, "+
    "p.time_bounds_lower AS t_min, p.time_bounds_upper AS t_max, "+
    "a.planeid AS obs_id, p.energy_bandpassname AS band "+
    "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "+
    "WHERE 1 = CONTAINS(POINT('ICRS', "+ra+", "+dec+"), p.poly) "+
    "AND a.uri LIKE '%"+releasePath+"%'"+timeClause+
    " ORDER BY p.time_bounds_lower";
  const tapBody=new URLSearchParams({REQUEST:"doQuery",LANG:"ADQL",FORMAT:"votable",QUERY:tapQuery});
  let tap,tapXml="";
  for(let attempt=0;attempt<2;attempt++){
    tap=await fetch(host+"/TAP/sync",{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        Accept:"application/x-votable+xml, application/xml, text/xml",
        "User-Agent":"COSMOS-SPHEREx-Explorer/1.0"
      },
      body:tapBody.toString(),
      signal:AbortSignal.timeout(15000)
    });
    tapXml=await tap.text();
    if(![429,500,502,503,504].includes(tap.status)||attempt===1)break;
    await new Promise(resolve=>setTimeout(resolve,700));
  }
  if(!tap.ok)throw new Error(lastError+"; TAP fallback HTTP "+tap.status);
  if(!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(tapXml))
    throw new Error(lastError+"; TAP fallback returned an unexpected response");
  const tapError=tapXml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
  if(tapError)throw new Error(tapError[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400)||"IRSA TAP rejected the query");
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
  const selectedCollection=String(q.get("collection")||"both");
  const collections=selectedCollection==="spherex_qr3"||selectedCollection==="spherex_dr1"
    ?[selectedCollection]:["spherex_qr3","spherex_dr1"];
  const jobs=collections.flatMap(collection=>
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
