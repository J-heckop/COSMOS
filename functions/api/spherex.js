// Cloudflare Pages Function: GET /api/spherex
// Search the official IRSA SPHEREx SIA2 archive. DR1 and QR3 each have
// separate wide/deep collections. TAP is a documented fallback for new data
// and for periods when SIA2 is temporarily unavailable.
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=30, s-maxage=180" : "no-store"
    }
  });
}

const IRSA = "https://irsa.ipac.caltech.edu";
const RELEASES = {
  spherex_dr1: { collections: ["spherex_dr1", "spherex_dr1_deep"], path: "/dr1/" },
  spherex_qr3: { collections: ["spherex_qr3", "spherex_qr3_deep"], path: "/qr3/" }
};

function validVOTable(xml) {
  return /<(?:[A-Za-z0-9_]+:)?VOTABLE\b/i.test(xml) &&
    !/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["']/i.test(xml);
}

function shortBody(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
}

async function querySIA(collection, ra, dec, radius, range, maxrec) {
  const params = new URLSearchParams({
    COLLECTION: collection,
    POS: "CIRCLE " + ra + " " + dec + " " + radius,
    MAXREC: String(maxrec),
    RESPONSEFORMAT: "application/x-votable+xml"
  });
  if (range) params.set("TIME", range.start + " " + range.end);

  let lastError = "No response from IRSA SIA2";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(IRSA + "/SIA?" + params.toString(), {
        headers: { Accept: "application/x-votable+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(12000)
      });
      const xml = await response.text();
      if (response.ok && validVOTable(xml)) {
        return { collection, period: range?.label || null, xml, source: "SIA2" };
      }
      lastError = "SIA2 HTTP " + response.status + (shortBody(xml) ? ": " + shortBody(xml) : "");
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error?.name === "TimeoutError" ? "SIA2 request timed out" : (error?.message || "SIA2 request failed");
      if (error?.name === "TimeoutError") break;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return { error: lastError, collection, period: range?.label || null };
}

async function queryTAP(ra, dec, radius, range, maxrec, band, selectedRelease) {
  // Mirrors the exact metadata-table join and spatial predicate in IRSA's
  // published SPHEREx cutout tutorial. DR1 and QR3 live in the same tables.
  const clauses = [
    "1 = CONTAINS(POINT('ICRS', " + ra + ", " + dec + "), p.poly)"
  ];
  if (band && band !== "all") {
    clauses.push("p.energy_bandpassname = '" + band + "'");
  }
  if (selectedRelease === "spherex_dr1") clauses.push("a.uri LIKE '%/dr1/%'");
  if (selectedRelease === "spherex_qr3") clauses.push("a.uri LIKE '%/qr3/%'");
  if (range) {
    clauses.push("p.time_bounds_lower <= " + range.end);
    clauses.push("p.time_bounds_upper >= " + range.start);
  }

  const size = Math.min(0.5, Math.max(0.01, radius * 2));
  const query = "SELECT TOP " + maxrec + " " +
    "'https://irsa.ipac.caltech.edu/' || a.uri AS access_url, " +
    "p.time_bounds_lower AS t_min, " +
    "p.time_bounds_upper AS t_max, " +
    "a.planeid AS obs_id, " +
    "p.energy_bandpassname AS band " +
    "FROM spherex.artifact a " +
    "JOIN spherex.plane p ON a.planeid = p.planeid " +
    "WHERE " + clauses.join(" AND ") +
    " ORDER BY p.time_bounds_lower";

  const body = new URLSearchParams({
    REQUEST: "doQuery",
    LANG: "ADQL",
    FORMAT: "votable",
    QUERY: query,
    MAXREC: String(maxrec)
  });

  const response = await fetch(IRSA + "/TAP/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/x-votable+xml, application/xml, text/xml"
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15000)
  });
  const xml = await response.text();
  if (!response.ok) {
    throw new Error("IRSA TAP HTTP " + response.status + (shortBody(xml) ? ": " + shortBody(xml) : ""));
  }
  if (!validVOTable(xml)) {
    throw new Error("IRSA TAP returned an invalid VOTable response: " + shortBody(xml));
  }
  const tapError = xml.match(/<INFO\b[^>]*name=["']QUERY_STATUS["'][^>]*value=["']ERROR["'][^>]*>([\s\S]*?)<\/INFO>/i);
  if (tapError) {
    throw new Error(tapError[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "IRSA rejected the TAP query.");
  }
  return {
    collection: selectedRelease || "spherex_dr1+qr3",
    period: range?.label || null,
    xml,
    source: "IRSA TAP"
  };
}

export async function onRequest({ request }) {
  if (request.method !== "GET") return json({ error: "Use GET for archive searches." }, 405);

  const q = new URL(request.url).searchParams;
  const ra = Number(q.get("ra"));
  const dec = Number(q.get("dec"));
  const radius = Number(q.get("radius"));
  if (!Number.isFinite(ra) || ra < 0 || ra > 360 ||
      !Number.isFinite(dec) || dec < -90 || dec > 90 ||
      !Number.isFinite(radius) || radius <= 0 || radius > 1) {
    return json({ error: "Invalid sky position or search radius." }, 400);
  }

  const maxrecRaw = Number(q.get("maxrec") || 150);
  const maxrec = Number.isFinite(maxrecRaw) ? Math.max(1, Math.min(150, Math.floor(maxrecRaw))) : 150;
  const requestedBand = String(q.get("band") || "SPHEREx-D2");
  if (requestedBand !== "all" && !/^SPHEREx-D[1-6]$/.test(requestedBand)) {
    return json({ error: "Choose a valid SPHEREx spectral band." }, 400);
  }

  const ranges = [];
  const hasA = q.has("startA") || q.has("endA") || q.has("start") || q.has("end");
  const hasB = q.has("startB") || q.has("endB");
  if (hasA) {
    const start = Number(q.has("startA") ? q.get("startA") : q.get("start"));
    const end = Number(q.has("endA") ? q.get("endA") : q.get("end"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
      return json({ error: "Invalid Period A observation time range." }, 400);
    }
    ranges.push({ label: "A", start, end });
  }
  if (hasB) {
    const start = Number(q.get("startB"));
    const end = Number(q.get("endB"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
      return json({ error: "Invalid Period B observation time range." }, 400);
    }
    ranges.push({ label: "B", start, end });
  }
  const requestedRanges = ranges.length ? ranges : [null];

  const selected = String(q.get("collection") || "both").toLowerCase();
  const releases = selected === "spherex_dr1" || selected === "spherex_qr3"
    ? [selected]
    : ["spherex_dr1", "spherex_qr3"];

  const results = [];
  const errors = [];

  // SIA2 is the preferred fast image search. Keep the four official wide/deep
  // collections in parallel, but cap retries so a gateway outage does not
  // exhaust the browser's request timeout.
  for (const range of requestedRanges) {
    const jobs = releases.flatMap(release =>
      RELEASES[release].collections.map(collection =>
        querySIA(collection, ra, dec, radius, range, maxrec)
      )
    );
    const settled = await Promise.all(jobs);
    for (const item of settled) {
      if (item.xml) results.push(item);
      else errors.push({
        collection: item.collection,
        period: item.period,
        error: item.error
      });
    }

    // If SIA2 returned nothing, use the exact TAP pattern published by IRSA.
    // TAP searches both releases together unless the user selected one release.
    if (!settled.some(item => item.xml)) {
      try {
        results.push(await queryTAP(ra, dec, radius, range, maxrec, requestedBand, selected));
      } catch (error) {
        errors.push({
          collection: selected || "spherex_dr1+qr3",
          period: range?.label || null,
          error: "TAP fallback: " + (error?.message || "archive query failed")
        });
      }
    }
  }

  if (!results.length) {
    return json({
      error: "IRSA's SPHEREx archive did not return a usable response.",
      detail: errors.map(item =>
        item.collection + (item.period ? " period " + item.period : "") + ": " + item.error
      ).join("; "),
      errors,
      source: "IRSA SIA2 + TAP",
      mode: ranges.length ? "comparison" : "observations"
    }, 502);
  }

  return json({
    done: true,
    results,
    errors,
    source: "IRSA SIA2",
    partial: errors.length > 0,
    band: requestedBand,
    note: "Searches DR1 and QR3 wide/deep image collections. Observation metadata is returned by IRSA."
  });
}
