const searchInput = document.querySelector("#space-search");
const cards = [...document.querySelectorAll(".object-card")];
const chips = [...document.querySelectorAll(".chip")];
const emptyState = document.querySelector("#empty-state");
let activeTopic = "all";

function filterCards() {
  const query = searchInput.value.trim().toLowerCase();
  let visible = 0;
  cards.forEach(card => {
    const matchesTopic = activeTopic === "all" || card.dataset.category === activeTopic;
    const matchesQuery = !query || card.dataset.search.includes(query) || card.innerText.toLowerCase().includes(query);
    const show = matchesTopic && matchesQuery;
    card.hidden = !show;
    if (show) visible++;
  });
  emptyState.hidden = visible !== 0;
}

chips.forEach(chip => chip.addEventListener("click", () => {
  chips.forEach(item => item.classList.remove("active"));
  chip.classList.add("active");
  activeTopic = chip.dataset.topic;
  filterCards();
}));
searchInput.addEventListener("input", filterCards);
document.querySelector("#search-button").addEventListener("click", filterCards);
searchInput.addEventListener("keydown", event => {
  if (event.key === "Enter") filterCards();
});
/* Query the official IRSA SPHEREx Simple Image Access service (SIA2). */
const archiveForm = document.querySelector("#archive-form");
if (archiveForm) {
  const statusBox = document.querySelector("#archive-status");
  const resultsBox = document.querySelector("#archive-results");
  const submitButton = document.querySelector("#archive-submit");
  const fallbackLink = document.querySelector("#archive-fallback");
  const exampleButton = document.querySelector("#example-coords");

  function setArchiveStatus(message, type = "") {
    statusBox.textContent = message;
    statusBox.className = "archive-status" + (type ? " " + type : "");
  }

  function parseVOTable(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The archive returned an unreadable table.");
    const byTag = name => [...doc.getElementsByTagNameNS("*", name)];
    const fields = byTag("FIELD").map(field => (field.getAttribute("name") || field.getAttribute("ID") || "").toLowerCase());
    const tableRows = byTag("TR").filter(row => row.parentNode && (row.parentNode.localName || row.parentNode.nodeName).toLowerCase() === "tabledata");
    return tableRows.map(row => {
      const values = byTag("TD").filter(cell => cell.parentNode === row).map(cell => cell.textContent.trim());
      return Object.fromEntries(fields.map((field, index) => [field, values[index] || ""]));
    });
  }

  function safeText(value, fallback = "Not supplied") {
    return value && value !== "null" && value !== "undefined" ? value : fallback;
  }

  archiveForm.addEventListener("submit", async event => {
    event.preventDefault();
    const ra = Number(document.querySelector("#ra-input").value);
    const dec = Number(document.querySelector("#dec-input").value);
    const radius = Number(document.querySelector("#radius-input").value);
    if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      setArchiveStatus("Please enter valid J2000 coordinates: RA 0–360° and Dec −90° to +90°.", "error");
      return;
    }

    const explorerUrl = new URL("https://irsa.ipac.caltech.edu/applications/spherex/");
    explorerUrl.search = new URLSearchParams({api:"spectral-images", ra:String(ra), dec:String(dec), sr:radius + "d"}).toString();
    fallbackLink.href = explorerUrl.href;
    resultsBox.replaceChildren();
    submitButton.disabled = true;
    submitButton.textContent = "Searching archive…";
    setArchiveStatus("Querying NASA/IPAC IRSA for SPHEREx observations near " + ra + "°, " + dec + "°.");

    try {
      const proxyUrl = new URL("/api/spherex", window.location.origin);
      proxyUrl.search = new URLSearchParams({ra:String(ra), dec:String(dec), radius:String(radius)}).toString();
      const response = await fetch(proxyUrl);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || "Archive proxy failed");
      const responses = payload.results.map(result => ({collection:result.collection, rows:parseVOTable(result.xml)}));
      const allRows = responses.flatMap(result => result.rows.map(row => ({...row, _collection:result.collection})));
      if (!allRows.length) {
        setArchiveStatus("No matching public observations were returned for this position and radius. Try a larger radius or open the official IRSA explorer.", "success");
      } else {
        setArchiveStatus("Found " + allRows.length + " archive result(s) across DR1 and QR3. These are real archive records; open a data link to inspect a file.", "success");
        allRows.slice(0, 30).forEach((row, index) => {
          const card = document.createElement("article");
          card.className = "archive-result";
          const details = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = safeText(row.obs_id, "SPHEREx observation " + (index + 1));
          const meta = document.createElement("span");
          const band = safeText(row.band, "Band not listed");
          const date = row.t_min ? " · MJD " + row.t_min : "";
          meta.textContent = row._collection.toUpperCase() + " · " + band + date;
          details.append(title, meta);
          const link = document.createElement("a");
          link.textContent = "Open data ↗";
          link.href = row.access_url || explorerUrl.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          card.append(details, link);
          resultsBox.append(card);
        });
      }
    } catch (error) {
      setArchiveStatus("The Vercel archive proxy could not complete the query (" + error.message + "). You can still run the same coordinate search in IRSA's official SPHEREx Explorer using the button below.", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Search SPHEREx <span>→</span>';
    }
  });

  exampleButton.addEventListener("click", () => {
    document.querySelector("#ra-input").value = "10.6847";
    document.querySelector("#dec-input").value = "41.2690";
    document.querySelector("#radius-input").value = "0.1";
    document.querySelector("#ra-input").focus();
  });
}

// Topic cards open a real detail panel instead of behaving like static artwork.
const topicDetails = {
  galaxies: {kicker:"01 / GALAXIES", title:"Galaxies", description:"Galaxies are enormous systems of stars, gas, dust and dark matter. They come in many shapes, from spirals to ellipticals, and contain clues about how the universe has evolved.", fact:"Near-infrared observations help reveal stars and regions that visible light can miss, including areas affected by cosmic dust. SPHEREx maps the sky in 102 infrared bands to study galaxies and their history."},
  nebulae: {kicker:"02 / NEBULAE", title:"Nebulae", description:"Nebulae are vast clouds of gas and dust. Some are stellar nurseries where new stars form; others are material shed by stars during later stages of their lives.", fact:"Infrared light can pass through some dust more effectively than visible light and can reveal emission from molecules and dusty regions. SPHEREx provides a wide-sky infrared view for studying these environments."},
  stars: {kicker:"03 / STARS", title:"Stars", description:"Stars are hot, luminous spheres of plasma. Their light, temperature and life cycles help astronomers understand how galaxies form and change.", fact:"SPHEREx observes stars and other nearby objects across many near-infrared bands. Comparing their brightness across wavelengths helps scientists study their properties and the material around them."},
  cosmology: {kicker:"04 / DEEP SPACE", title:"The deep universe", description:"Looking far across space also means looking back in time. Distant galaxies carry information about the early universe and how large-scale cosmic structure developed.", fact:"One of SPHEREx’s major goals is to map millions of galaxies and investigate the history of the universe, including the physics of cosmic inflation."}
};
const topicDialog = document.querySelector("#topic-dialog");
if (topicDialog) {
  const title = document.querySelector("#topic-dialog-title");
  const kicker = document.querySelector("#topic-dialog-kicker");
  const description = document.querySelector("#topic-dialog-description");
  const fact = document.querySelector("#topic-dialog-fact");
  const closeDialog = () => topicDialog.close();
  cards.forEach(card => {
    card.addEventListener("click", () => {
      const detail = topicDetails[card.dataset.category];
      if (!detail) return;
      kicker.textContent = detail.kicker;
      title.textContent = detail.title;
      description.textContent = detail.description;
      fact.textContent = detail.fact;
      topicDialog.showModal();
    });
  });
  document.querySelector("#topic-dialog-close").addEventListener("click", closeDialog);
  topicDialog.addEventListener("click", event => {
    if (event.target === topicDialog) closeDialog();
  });
}


// Compare SPHEREx observations at one sky position across two date windows.
const timeForm = document.querySelector("#time-compare-form");
if (timeForm) {
  const timeStatus = document.querySelector("#time-status");
  const timeButton = document.querySelector("#time-submit");
  const dateA = document.querySelector("#date-a");
  const dateB = document.querySelector("#date-b");
  const discoverButton = document.querySelector("#discover-dates");
  const today = new Date().toISOString().slice(0, 10);
  let discoveredDates = [];

  function timeSafeText(value, fallback = "Not supplied") {
    return value && value !== "null" && value !== "undefined" ? value : fallback;
  }
  function timeParseVOTable(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The archive returned an unreadable table.");
    const all = name => [...doc.getElementsByTagNameNS("*", name)];
    const fields = all("FIELD").map(field => (field.getAttribute("name") || field.getAttribute("ID") || "").toLowerCase());
    const rows = all("TR").filter(row => row.parentNode && (row.parentNode.localName || row.parentNode.nodeName).toLowerCase() === "tabledata");
    return rows.map(row => {
      const values = [...row.childNodes].filter(node => node.nodeType === 1 && (node.localName || node.nodeName).toLowerCase() === "td").map(cell => cell.textContent.trim());
      return Object.fromEntries(fields.map((field,index) => [field,values[index] || ""]));
    });
  }
  function dateToMJD(dateString, endOfDay = false) {
    const date = new Date(dateString + (endOfDay ? "T23:59:59Z" : "T00:00:00Z"));
    return date.getTime() / 86400000 + 40587;
  }
  function dateLabel(value) {
    return new Date(value + "T00:00:00Z").toLocaleDateString(undefined, {year:"numeric",month:"short",day:"numeric",timeZone:"UTC"});
  }
  function fillDateSelect(select, dates, selected) {
    select.replaceChildren();
    dates.forEach(date => {
      const option = document.createElement("option");
      option.value = date;
      option.textContent = dateLabel(date);
      select.append(option);
    });
    select.disabled = dates.length === 0;
    if (selected && dates.includes(selected)) select.value = selected;
  }
  discoverButton.addEventListener("click", async () => {
    const ra = Number(document.querySelector("#ra-input").value);
    const dec = Number(document.querySelector("#dec-input").value);
    const radius = Number(document.querySelector("#radius-input").value);
    if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      timeStatus.textContent = "Enter valid RA and Dec coordinates in the archive search above first.";
      timeStatus.className = "archive-status error";
      return;
    }
    discoverButton.disabled = true;
    discoverButton.textContent = "Discovering archive dates…";
    timeStatus.textContent = "Checking the official SPHEREx archive for observation timestamps at this position…";
    timeStatus.className = "archive-status";
    try {
      const url = new URL("/api/spherex", window.location.origin);
      url.search = new URLSearchParams({ra:String(ra),dec:String(dec),radius:String(radius)}).toString();
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || "Archive query failed.");
      const records = payload.results.flatMap(result => timeParseVOTable(result.xml));
      const unique = new Map();
      records.forEach(row => {
        const mjd = Number(row.t_min);
        if (!Number.isFinite(mjd) || mjd <= 0) return;
        const date = new Date((mjd - 40587) * 86400000).toISOString().slice(0,10);
        if (date >= "2025-05-01" && date <= today) unique.set(date, date);
      });
      discoveredDates = [...unique.keys()].sort();
      fillDateSelect(dateA, discoveredDates, discoveredDates[0]);
      fillDateSelect(dateB, discoveredDates, discoveredDates.length > 1 ? discoveredDates[discoveredDates.length - 1] : discoveredDates[0]);
      timeButton.disabled = discoveredDates.length < 2;
      if (discoveredDates.length >= 2) {
        timeStatus.textContent = "Found " + records.length + " archive record(s) across " + discoveredDates.length + " distinct observation date(s). Choose two dates to compare.";
        timeStatus.className = "archive-status success";
      } else if (discoveredDates.length === 1) {
        timeStatus.textContent = "The archive returned observations on only one distinct date for this position. A date-to-date comparison needs at least two dates.";
        timeStatus.className = "archive-status";
      } else {
        timeStatus.textContent = "No dated observations were returned for this position. Try a wider search radius or another sky position.";
        timeStatus.className = "archive-status";
      }
    } catch (error) {
      timeStatus.textContent = "Could not discover observation dates: " + error.message;
      timeStatus.className = "archive-status error";
    } finally {
      discoverButton.disabled = false;
      discoverButton.textContent = "Find available observation dates";
    }
  });
  function setImageMessage(period, message) {
    const canvas = document.querySelector("#image-" + period);
    const placeholder = document.querySelector("#image-" + period + "-placeholder");
    const status = document.querySelector("#image-" + period + "-status");
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (placeholder) { placeholder.hidden = false; placeholder.textContent = message; }
    if (status) status.textContent = message;
  }

  async function renderSpherexImage(period, row, ra, dec, radius) {
    const canvas = document.querySelector("#image-" + period);
    const placeholder = document.querySelector("#image-" + period + "-placeholder");
    const status = document.querySelector("#image-" + period + "-status");
    if (!row || !row.access_url) {
      setImageMessage(period, "No image product is available for this period.");
      return;
    }
    if (!window.astro || !window.astro.FITS) {
      setImageMessage(period, "The FITS image viewer could not load. Use the original data link.");
      return;
    }
    placeholder.hidden = false;
    placeholder.textContent = "Loading real SPHEREx image…";
    status.textContent = "Retrieving FITS cutout from IRSA…";
    try {
      const url = new URL("/api/spherex-image", window.location.origin);
      url.search = new URLSearchParams({
        url: row.access_url,
        ra: String(ra),
        dec: String(dec),
        size: String(Math.min(0.5, Math.max(0.03, radius * 2)))
      }).toString();
      const response = await fetch(url, {signal: AbortSignal.timeout(60000)});
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(problem.detail || problem.error || "Image request failed (HTTP " + response.status + ")");
      }
      const blob = await response.blob();
      if (blob.size < 2880) throw new Error("The archive returned an empty FITS cutout.");
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
        const fits = new astro.FITS(blob, function() {
          try {
            const imageHdu = (this.hdus || []).find(hdu => hdu.data instanceof astro.FITS.Image);
            if (!imageHdu) throw new Error("No image plane was found in this FITS product.");
            const image = imageHdu.data;
            image.getFrame(0, pixels => {
              try {
                const width = image.width;
                const height = image.height;
                if (!width || !height || !pixels || !pixels.length) throw new Error("The FITS image contains no displayable pixels.");
                // Robust astronomical stretch: estimate the sky background and noise
                // with the median + MAD, then map the useful signal with an asinh curve.
                // This suppresses grain without changing the underlying FITS data.
                const sample = [];
                const stride = Math.max(1, Math.floor(pixels.length / 24000));
                for (let i = 0; i < pixels.length; i += stride) {
                  const value = Number(pixels[i]);
                  if (Number.isFinite(value)) sample.push(value);
                }
                sample.sort((a,b) => a-b);
                if (!sample.length) throw new Error("No finite pixel values were found.");
                const percentile = p => sample[Math.min(sample.length - 1, Math.max(0, Math.floor((sample.length - 1) * p)))];
                const median = percentile(0.5);
                const deviations = sample.map(value => Math.abs(value - median)).sort((a,b) => a-b);
                const mad = deviations[Math.floor((deviations.length - 1) * 0.5)] || 0;
                const sigma = Math.max(mad * 1.4826, (percentile(0.75) - percentile(0.25)) / 1.349, 1e-12);
                const low = median + sigma * 0.35;
                const high = Math.max(percentile(0.997), low + sigma * 3.5);
                const span = high - low;
                const asinhMax = Math.asinh(8);
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d", { willReadFrequently: false });
                const pixelsOut = context.createImageData(width, height);
                for (let y = 0; y < height; y++) {
                  for (let x = 0; x < width; x++) {
                    const sourceIndex = y * width + x;
                    const value = Number(pixels[sourceIndex]);
                    let normalized = 0;
                    if (Number.isFinite(value) && value > low) {
                      const linear = Math.max(0, Math.min(1, (value - low) / span));
                      normalized = Math.asinh(linear * 8) / asinhMax;
                    }
                    // A gentle display gamma preserves faint sources while keeping the sky dark.
                    const shade = Math.round(Math.pow(normalized, 0.82) * 255);
                    const targetIndex = ((height - 1 - y) * width + x) * 4;
                    pixelsOut.data[targetIndex] = shade;
                    pixelsOut.data[targetIndex + 1] = Math.min(255, Math.round(shade * 0.96));
                    pixelsOut.data[targetIndex + 2] = Math.min(255, Math.round(shade * 0.86));
                    pixelsOut.data[targetIndex + 3] = 255;
                  }
                }
                context.putImageData(pixelsOut, 0, 0);
                placeholder.hidden = true;
                status.textContent = "Showing FITS cutout · " + timeSafeText(row.obs_id, "SPHEREx observation");
                finish(resolve);
              } catch (error) { finish(reject, error); }
            });
          } catch (error) { finish(reject, error); }
        });
        window.setTimeout(() => finish(reject, new Error("FITS image parsing timed out.")), 55000);
      });
    } catch (error) {
      placeholder.hidden = false;
      placeholder.textContent = "Image preview is temporarily unavailable.";
      status.textContent = error.message;
      const pane = canvas && canvas.closest(".image-pane");
      if (pane && row.access_url && !pane.querySelector(".image-fallback-link")) {
        const fallback = document.createElement("a");
        fallback.className = "image-fallback-link";
        fallback.href = row.access_url;
        fallback.target = "_blank";
        fallback.rel = "noopener noreferrer";
        fallback.textContent = "Open original SPHEREx FITS product ↗";
        pane.append(fallback);
      }
    }
  }

  function appendTimeRecords(target, rows, collection) {
    target.replaceChildren();
    const unique = [...new Map(rows.map(row => {
      const key = [row.obs_id || "", row.access_url || "", row.t_min || ""].join("|");
      return [key, row];
    })).values()];
    if (!unique.length) {
      const empty = document.createElement("p");
      empty.className = "time-empty";
      empty.textContent = "No matching observations in this date window.";
      target.append(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "time-record-list";
    unique.forEach((row, index) => {
      const item = document.createElement("article");
      item.className = "archive-result";
      if (index >= 3) item.hidden = true;
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = timeSafeText(row.obs_id, "Observation " + (index + 1));
      const meta = document.createElement("span");
      const mjd = Number(row.t_min);
      const date = Number.isFinite(mjd) ? new Date((mjd - 40587) * 86400000).toISOString().slice(0,10) : "Date not listed";
      meta.textContent = collection.toUpperCase() + " · " + timeSafeText(row.band || row.energy_bandpassname, "Band not listed") + " · " + date;
      info.append(name, meta);
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "preview-image-button";
      preview.textContent = "Preview image";
      preview.addEventListener("click", () => {
        const period = target.id === "period-a-results" ? "a" : "b";
        const ra = Number(document.querySelector("#ra-input").value);
        const dec = Number(document.querySelector("#dec-input").value);
        const radius = Number(document.querySelector("#radius-input").value);
        renderSpherexImage(period, row, ra, dec, radius);
      });
      const link = document.createElement("a");
      link.textContent = "Open FITS data ↗";
      link.href = row.access_url || "https://irsa.ipac.caltech.edu/applications/spherex/";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(info, preview, link);
      list.append(item);
    });
    target.append(list);
    if (unique.length > 3) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "results-toggle";
      more.textContent = "View all " + unique.length + " observations";
      more.addEventListener("click", () => {
        const expanded = more.getAttribute("aria-expanded") === "true";
        [...list.children].forEach((item,index) => { if (index >= 3) item.hidden = expanded; });
        more.setAttribute("aria-expanded", String(!expanded));
        more.textContent = expanded ? "View all " + unique.length + " observations" : "Show fewer observations";
      });
      more.setAttribute("aria-expanded", "false");
      target.append(more);
    }
  }
  const positionTestButton = document.querySelector("#position-only-test");
  if (positionTestButton) {
    positionTestButton.addEventListener("click", async () => {
      const ra = Number(document.querySelector("#ra-input").value);
      const dec = Number(document.querySelector("#dec-input").value);
      const radius = Number(document.querySelector("#radius-input").value);
      const status = document.querySelector("#position-only-status");
      const output = document.querySelector("#position-only-results");
      if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
        status.textContent = "Enter valid RA and Dec coordinates in the archive search above first.";
        status.className = "archive-status error";
        return;
      }
      positionTestButton.disabled = true;
      positionTestButton.textContent = "Checking position…";
      output.replaceChildren();
      status.textContent = "Checking both SPHEREx collections without any date filter…";
      status.className = "archive-status";
      try {
        const url = new URL("/api/spherex", window.location.origin);
        url.search = new URLSearchParams({ra:String(ra),dec:String(dec),radius:String(radius)}).toString();
        const response = await fetch(url);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || "Archive proxy failed");
        const sets = payload.results.map(result => ({collection:result.collection,rows:parseVOTable(result.xml)}));
        const total = sets.reduce((sum,set)=>sum+set.rows.length,0);
        if (!total) {
          status.textContent = "The archive returned zero rows even without a date filter. This points to a position/collection query issue, not your selected dates.";
          status.className = "archive-status error";
        } else {
          status.textContent = "Position-only test found " + total + " observation record(s). The sky position works; now we can isolate the date filter.";
          status.className = "archive-status success";
          sets.forEach(set => appendTimeRecords(output,set.rows,set.collection));
        }
      } catch (error) {
        status.textContent = "Position-only test failed: " + error.message;
        status.className = "archive-status error";
      } finally {
        positionTestButton.disabled = false;
        positionTestButton.textContent = "Test this sky position (ignore dates)";
      }
    });
  }

  timeForm.addEventListener("submit", async event => {
    event.preventDefault();
    const ra = Number(document.querySelector("#ra-input").value);
    const dec = Number(document.querySelector("#dec-input").value);
    const radius = Number(document.querySelector("#radius-input").value);
    const aDate = dateA.value;
    const bDate = dateB.value;
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra > 360 || dec < -90 || dec > 90) {
      timeStatus.textContent = "Enter valid RA and Dec coordinates in the archive search above first.";
      timeStatus.className = "archive-status error";
      return;
    }
    if (!aDate || !bDate || !discoveredDates.includes(aDate) || !discoveredDates.includes(bDate)) {
      timeStatus.textContent = "Discover available observation dates first.";
      timeStatus.className = "archive-status error";
      return;
    }
    if (aDate === bDate) {
      timeStatus.textContent = "Choose two different observation dates to compare.";
      timeStatus.className = "archive-status error";
      return;
    }
    document.querySelector("#period-a-label").textContent = dateLabel(aDate);
    document.querySelector("#period-b-label").textContent = dateLabel(bDate);
    const outputA = document.querySelector("#period-a-results");
    const outputB = document.querySelector("#period-b-results");
    outputA.replaceChildren(); outputB.replaceChildren();
    timeButton.disabled = true;
    timeButton.textContent = "Comparing…";
    timeStatus.textContent = "Searching the archive for both periods… Image previews will load only when you request them.";
    timeStatus.className = "archive-status";
    async function queryWindow(start, end) {
      const url = new URL("/api/spherex", window.location.origin);
      url.search = new URLSearchParams({
        ra:String(ra), dec:String(dec), radius:String(radius),
        start:String(dateToMJD(start)), end:String(dateToMJD(end, true))
      }).toString();
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || "Archive proxy failed");
      const resultSets = payload.results.map(result => ({collection:result.collection, rows:timeParseVOTable(result.xml)}));
      const combined = resultSets.flatMap(set => set.rows.map(row => ({row, collection:set.collection})));
      const unique = new Map();
      combined.forEach(item => {
        const key = [item.collection, item.row.obs_id || "", item.row.access_url || "", item.row.t_min || ""].join("|");
        if (!unique.has(key)) unique.set(key, item);
      });
      return [...unique.values()];
    }
    try {
      const [a,b] = await Promise.all([queryWindow(aDate,aDate),queryWindow(bDate,bDate)]);
      appendTimeRecords(outputA,a.map(x=>x.row),"DR1 / QR3");
      appendTimeRecords(outputB,b.map(x=>x.row),"DR1 / QR3");
      // Keep the comparison fast: never download or parse FITS images during metadata search.
      // Users can request a preview with the individual "Preview image" button on any result.
      if (a.length) setImageMessage("a", "Comparison ready. Tap Preview image on a Period A observation below to load its FITS cutout.");
      else setImageMessage("a", "No matching observation image in Period A.");
      if (b.length) setImageMessage("b", "Comparison ready. Tap Preview image on a Period B observation below to load its FITS cutout.");
      else setImageMessage("b", "No matching observation image in Period B.");
      // Replace generic collection labels with the actual release for each result row.
      [ [outputA,a], [outputB,b] ].forEach(([container,sets]) => {
        const links=[...container.querySelectorAll(".archive-result")];
        links.forEach((item,index) => { const meta=item.querySelector("span"); if(meta && sets[index]) meta.textContent=sets[index].collection.toUpperCase()+" · "+timeSafeText(sets[index].row.band || sets[index].row.energy_bandpassname,"Band not listed")+" · "+(Number.isFinite(Number(sets[index].row.t_min))?new Date((Number(sets[index].row.t_min)-40587)*86400000).toISOString().slice(0,10):"Date not listed"); });
      });
      timeStatus.textContent = "Comparison ready: " + a.length + " observation(s) in Period A and " + b.length + " in Period B. Image downloads are separate—tap Preview image on a record when you want to inspect it.";
      timeStatus.className = "archive-status success";
    } catch (error) {
      timeStatus.textContent = "The archive proxy could not complete the request (" + error.message + "). Try the official SPHEREx Data Explorer, which supports position and timing constraints.";
      timeStatus.className = "archive-status error";
      const official = document.createElement("a");
      official.href = "https://irsa.ipac.caltech.edu/applications/spherex/";
      official.target = "_blank"; official.rel = "noopener noreferrer";
      official.className = "archive-fallback"; official.textContent = "Open official SPHEREx Data Explorer ↗";
      timeStatus.append(" ",official);
    } finally {
      timeButton.disabled = false;
      timeButton.innerHTML = 'Compare observations <span>→</span>';
    }
  });
}
