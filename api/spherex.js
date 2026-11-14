// Vercel serverless proxy for the public NASA/IPAC IRSA SPHEREx SIA2 service.
// Keeps browser requests same-origin; no API key or credentials are used.
const ALLOWED_COLLECTIONS = new Set(["spherex_dr1", "spherex_qr3"]);

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
  const ra = Number(q.ra);
  const dec = Number(q.dec);
  const radius = Number(q.radius);
  if (!Number.isFinite(ra) || ra < 0 || ra > 360 ||
      !Number.isFinite(dec) || dec < -90 || dec > 90 ||
      !Number.isFinite(radius) || radius <= 0 || radius > 1) {
    return send(res, 400, { error: "Invalid sky position or search radius." });
  }

  const collections = String(q.collections || "spherex_dr1,spherex_qr3")
    .split(",").filter(value => ALLOWED_COLLECTIONS.has(value));
  if (!collections.length) return send(res, 400, { error: "No supported SPHEREx collection selected." });

  const requestedMax = Number.parseInt(q.maxrec || "30", 10);
  const maxrec = Number.isFinite(requestedMax) ? Math.min(1000, Math.max(1, requestedMax)) : 30;
  const params = new URLSearchParams({
    POS: `CIRCLE ${ra} ${dec} ${radius}`,
    RESPONSEFORMAT: "VOTABLE",
    MAXREC: String(maxrec)
  });

  if (q.start !== undefined || q.end !== undefined) {
    const start = Number(q.start);
    const end = Number(q.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
      return send(res, 400, { error: "Invalid observation time range." });
    }
    params.set("TIME", `${start} ${end}`);
  }

  try {
    const settled = await Promise.allSettled(collections.map(async collection => {
      const url = new URL("https://irsa.ipac.caltech.edu/SIA");
      const collectionParams = new URLSearchParams(params);
      collectionParams.set("COLLECTION", collection);
      url.search = collectionParams.toString();
      const startedAt = Date.now();
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/x-votable+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(18000)
      });
      if (!response.ok) throw new Error(`${collection} returned HTTP ${response.status}`);
      const xml = await response.text();
      if (!/<(?:[A-Za-z0-9_]+:)?VOTABLE\\b/i.test(xml)) {
        throw new Error(`${collection} did not return a VOTable response`);
      }
      return { collection, xml, elapsed_ms: Date.now() - startedAt };
    }));
    const results = settled.filter(item => item.status === "fulfilled").map(item => item.value);
    const errors = settled.filter(item => item.status === "rejected").map((item, index) => ({
      collection: collections[settled.findIndex(x => x === item)] || "unknown",
      detail: item.reason && item.reason.message ? item.reason.message : "Archive request failed."
    }));
    if (!results.length) return send(res, 502, {
      error: "All SPHEREx archive collection requests failed.",
      detail: errors.map(item => item.collection + ": " + item.detail).join("; "),
      errors
    });
    return send(res, 200, { results, errors });
  } catch (error) {
    return send(res, 502, { error: "IRSA archive request failed.", detail: error.message });
  }
};
