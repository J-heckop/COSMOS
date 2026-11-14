// SPHEREx archive search via IRSA TAP, following the official IRSA tutorial schema.
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Use GET for archive searches." });
  }
  const q = req.query || {};
  const ra = Number(q.ra), dec = Number(q.dec), radius = Number(q.radius);
  if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90 || !Number.isFinite(radius) || radius <= 0 || radius > 1) {
    return send(res, 400, { error: "Invalid sky position or search radius." });
  }
  const n = Number.parseInt(q.maxrec || "100", 10);
  const maxrec = Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : 100;
  const size = Math.min(0.5, Math.max(0.03, radius * 2));
  const start = q.start === undefined ? null : Number(q.start);
  const end = q.end === undefined ? null : Number(q.end);
  if ((start !== null || end !== null) && (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start)) {
    return send(res, 400, { error: "Invalid observation time range." });
  }
  const accessUrl = "'https://irsa.ipac.caltech.edu/' || a.uri || '?center=" + ra + "," + dec + "&size=" + size + "'";
  const where = ["1 = CONTAINS(POINT('ICRS', " + ra + ", " + dec + "), p.poly)"];
  if (start !== null && end !== null) {
    where.push("p.time_bounds_lower <= " + end);
    where.push("p.time_bounds_upper >= " + start);
  }
  const adql = "SELECT TOP " + maxrec + " p.planeid AS obs_id, p.time_bounds_lower AS t_min, p.time_bounds_upper AS t_max, p.energy_bandpassname AS band, " + accessUrl + " AS access_url FROM spherex.artifact AS a JOIN spherex.plane AS p ON a.planeid = p.planeid WHERE " + where.join(" AND ") + " ORDER BY p.time_bounds_lower";
  try {
    const body = new URLSearchParams({REQUEST:"doQuery",LANG:"ADQL",FORMAT:"votable",QUERY:adql});
    const response = await fetch("https://irsa.ipac.caltech.edu/TAP/sync", {
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/x-votable+xml, application/xml, text/xml"},
      body,
      signal:AbortSignal.timeout(45000)
    });
    const xml = await response.text();
    if (!response.ok) return send(res,502,{error:"IRSA TAP query failed.",detail:"HTTP "+response.status});
    if (!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml)) return send(res,502,{error:"IRSA returned an unexpected TAP response.",detail:xml.slice(0,500)});
    return send(res,200,{results:[{collection:"SPHEREx TAP",xml}],errors:[],source:"IRSA TAP"});
  } catch (error) {
    return send(res,502,{error:"The IRSA SPHEREx TAP service could not complete the query.",detail:error && error.message ? error.message : "Unknown archive error."});
  }
};
