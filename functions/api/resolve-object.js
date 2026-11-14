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
   const raText=tag(xml,"jradeg"),decText=tag(xml,"jdedeg");
   // Number("") is 0 in JavaScript. Never accept missing resolver fields as valid coordinates.
   if(!raText||!decText){
    lastError="The name resolver returned no coordinates for “"+name+"”. Try a more specific astronomical designation.";
    continue;
   }
   const ra=Number(raText),dec=Number(decText);
   if(!Number.isFinite(ra)||ra<0||ra>360||!Number.isFinite(dec)||dec< -90||dec>90){
    lastError="The resolver returned invalid coordinates. Check the object name and try again.";
    continue;
   }
   const resolvedName=tag(xml,"oname");
   if(!resolvedName){
    lastError="The resolver did not confirm an object match for “"+name+"”. Try a catalogue designation.";
    continue;
   }
   return json({name:resolvedName,ra,dec,source:"CDS Sesame"});
  }catch(error){lastError=error?.name==="TimeoutError"?"The astronomical name resolver timed out. Try again shortly.":(error?.message||lastError);}
 }
 return json({error:lastError},502);
}