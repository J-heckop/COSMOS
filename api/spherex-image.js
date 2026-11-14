// Same-origin FITS cutout proxy for public SPHEREx spectral-image products.
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Use GET for image previews." });
  }
  try {
    const q = req.query || {};
    const source = new URL(String(q.url || ""));
    const ra = Number(q.ra);
    const dec = Number(q.dec);
    const size = Number(q.size || 0.1);
    if (source.protocol !== "https:" || source.hostname !== "irsa.ipac.caltech.edu" ||
        !source.pathname.startsWith("/ibe/data/spherex/") || !source.pathname.endsWith(".fits")) {
      return send(res, 400, { error: "Only official SPHEREx FITS image products can be previewed." });
    }
    if (!Number.isFinite(ra) || ra < 0 || ra > 360 ||
        !Number.isFinite(dec) || dec < -90 || dec > 90 ||
        !Number.isFinite(size) || size <= 0 || size > 0.5) {
      return send(res, 400, { error: "Invalid image cutout coordinates or size." });
    }
    // Use the documented SPHEREx cutout URL syntax; retry smaller cutouts if IRSA is busy.
    const sizes = [...new Set([size, Math.max(0.03, size / 2)])];
    let upstream;
    let lastStatus = 0;
    for (let attempt = 0; attempt < sizes.length; attempt += 1) {
      const attemptUrl = new URL(source.toString());
      attemptUrl.searchParams.set("center", ra + "," + dec);
      attemptUrl.searchParams.set("size", String(sizes[attempt]));
      attemptUrl.searchParams.delete("gzip");
      upstream = await fetch(attemptUrl.toString(), {
        headers: { Accept: "application/fits, application/octet-stream" },
        signal: AbortSignal.timeout(11000)
      });
      if (upstream.ok) break;
      lastStatus = upstream.status;
      if (![429, 500, 502, 503, 504].includes(upstream.status) || attempt === sizes.length - 1) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!upstream || !upstream.ok) {
      res.setHeader("Retry-After", "30");
      return send(res, lastStatus === 503 ? 503 : 502, {
        error: "IRSA SPHEREx cutout service is temporarily unavailable.",
        detail: "The observation record exists, but IRSA could not create its image cutout (HTTP " + lastStatus + "). Try again later or open the original FITS product.",
        retryable: true
      });
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length < 2880 || bytes.toString("ascii", 0, 8).indexOf("SIMPLE") !== 0) {
      return send(res, 502, { error: "IRSA did not return a readable FITS image." });
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/fits");
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Disposition", "inline; filename=spherex-cutout.fits");
    return res.end(bytes);
  } catch (error) {
    return send(res, 502, { error: "Could not retrieve the SPHEREx image cutout.", detail: error.message });
  }
};
