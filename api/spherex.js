// SPHEREx image search through IRSA's official SIA2 image-access API.
// SIA2 is purpose-built for spatial image searches; avoid expensive TAP polygon joins here.
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

  const parsedMax = Number.parseInt(q.maxrec || "20", 10);
  const maxrec = Number.isFinite(parsedMax) ? Math.min(50, Math.max(1, parsedMax)) : 30;

  const ranges = [];
  const hasA = q.startA !== undefined || q.endA !== undefined || q.start !== undefined || q.end !== undefined;
  const hasB = q.startB !== undefined || q.endB !== undefined;

  if (hasA) {
    const start = Number(q.startA !== undefined ? q.startA : q.start);
    const end = Number(q.endA !== undefined ? q.endA : q.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
      return send(res, 400, { error: "Invalid Period A observation time range." });
    }
    ranges.push({ label: "A", start, end });
  }
  if (hasB) {
    const start = Number(q.startB);
    const end = Number(q.endB);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
      return send(res, 400, { error: "Invalid Period B observation time range." });
    }
    ranges.push({ label: "B", start, end });
  }
  if (!ranges.length) ranges.push(null);

  const collections = ["spherex_dr1", "spherex_qr3"];
  const jobs = collections.flatMap(collection => ranges.map(range => ({ collection, range })));

  const settled = await Promise.all(jobs.map(async job => {
    const params = new URLSearchParams();
    params.set("COLLECTION", job.collection);
    params.set("POS", "CIRCLE " + ra + " " + dec + " " + radius);
    params.set("MAXREC", String(maxrec));
    params.set("RESPONSEFORMAT", "VOTABLE");
    if (job.range) params.set("TIME", job.range.start + " " + job.range.end);

    try {
      const response = await fetch("https://irsa.ipac.caltech.edu/SIA?" + params.toString(), {
        headers: { "Accept": "application/x-votable+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(48000)
      });
      const xml = await response.text();
      if (!response.ok) {
        return { ok: false, collection: job.collection, period: job.range && job.range.label, error: "IRSA SIA2 returned HTTP " + response.status };
      }
      if (!/<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml)) {
        return { ok: false, collection: job.collection, period: job.range && job.range.label, error: "IRSA returned an unexpected SIA2 response." };
      }
      return { ok: true, collection: job.collection, period: job.range && job.range.label, xml };
    } catch (error) {
      return { ok: false, collection: job.collection, period: job.range && job.range.label, error: error && error.name === "TimeoutError" ? "IRSA SIA2 request timed out." : (error && error.message ? error.message : "Unknown archive error.") };
    }
  }));

  const results = settled.filter(item => item.ok).map(item => ({
    collection: item.collection,
    period: item.period,
    xml: item.xml
  }));
  const errors = settled.filter(item => !item.ok).map(item => ({
    collection: item.collection,
    period: item.period,
    error: item.error
  }));

  if (!results.length) {
    return send(res, 502, {
      error: "The IRSA SPHEREx image search could not be completed.",
      detail: errors.map(item => item.collection + (item.period ? " Period " + item.period : "") + ": " + item.error).join(" "),
      errors
    });
  }

  return send(res, 200, {
    results,
    errors,
    source: "IRSA SIA2",
    partial: errors.length > 0
  });
};
