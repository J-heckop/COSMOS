function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function tag(xml,name){
 const match=xml.match(new RegExp("<(?:[A-Za-z0-9_]+:)?"+name+"[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?"+name+">","i"));
 return match?match[1].replace(/<!\[CDATA\[|\]\]>/g,"").trim():"";
}
export async function onRequest({request}){
 if(request.method!=="GET")return json({error:"Use GET for object lookups."},405);
 const name=(new URL(request.url).searchParams.get("name")||"").trim();
 if(!name||name.length>100||/[<>\u0000-\u001f]/.test(name))return json({error:"Enter an astronomical object name (up to 100 characters)."},400);
 const mirrors=[
  "https://vizier.idia.ac.za/viz-bin/nph-sesame/-ox/?",
  "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-ox/?"
 ];
 let lastError="The name resolver did not respond.";
 for(const base of mirrors){
  try{
   const response=await fetch(base+encodeURIComponent(name),{headers:{Accept:"application/xml,text/xml"},signal:AbortSignal.timeout(9000)});
   if(!response.ok){lastError="Name resolver returned HTTP "+response.status;continue;}
   const xml=await response.text();
   const ra=Number(tag(xml,"jradeg")),dec=Number(tag(xml,"jdedeg"));
   if(!Number.isFinite(ra)||ra<0||ra>360||!Number.isFinite(dec)||dec< -90||dec>90){
    lastError="No matching astronomical object was found. Check the name and try another designation.";
    continue;
   }
   return json({name:tag(xml,"oname")||name,ra,dec,source:"CDS Sesame"});
  }catch(error){lastError=error?.name==="TimeoutError"?"The astronomical name resolver timed out. Try again shortly.":(error?.message||lastError);}
 }
 return json({error:lastError},502);
}