// Vercel serverless function: GET /api/resolve-object?name=Orion%20Nebula
// Resolves astronomical names through the official CDS Sesame service.
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}

function xmlTag(xml, name) {
  const pattern = "<(?:[A-Za-z0-9_]+:)?" + name + "[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?" + name + ">";
  const match = xml.match(new RegExp(pattern, "i"));
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]*>/g, "").trim() : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Use GET for object lookups." });
  }

  const rawName = req.query && req.query.name;
  const name = (Array.isArray(rawName) ? rawName[0] : String(rawName || "")).trim();
  if (!name || name.length > 100 || /[<>\u0000-\u001f]/.test(name)) {
    return send(res, 400, { error: "Enter an astronomical object name (up to 100 characters)." });
  }

  const mirrors = [
    "https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/?",
    "https://vizier.idia.ac.za/viz-bin/nph-sesame/-ox/?",
    "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-ox/?"
  ];
  let lastError = "The astronomical name resolver did not respond.";

  for (const base of mirrors) {
    try {
      const response = await fetch(base + encodeURIComponent(name), {
        headers: { Accept: "application/xml, text/xml" },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        lastError = "The name resolver returned HTTP " + response.status + ".";
        continue;
      }

      const xml = await response.text();
      const raText = xmlTag(xml, "jradeg");
      const decText = xmlTag(xml, "jdedeg");
      const resolvedName = xmlTag(xml, "oname") || xmlTag(xml, "name");
      if (!raText || !decText || !resolvedName) {
        lastError = "No confirmed coordinates were found for “" + name + "”. Try a more specific object name.";
        continue;
      }

      const ra = Number(raText);
      const dec = Number(decText);
      if (!Number.isFinite(ra) || ra < 0 || ra > 360 ||
          !Number.isFinite(dec) || dec < -90 || dec > 90) {
        lastError = "The resolver returned invalid coordinates. Try another object designation.";
        continue;
      }
      return send(res, 200, { name: resolvedName, ra, dec, source: "CDS Sesame" });
    } catch (error) {
      lastError = error && error.name === "TimeoutError"
        ? "The astronomical name resolver timed out."
        : (error && error.message ? error.message : lastError);
    }
  }
  return send(res, 502, { error: lastError });
};
