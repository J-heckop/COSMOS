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
    const fields = [...doc.querySelectorAll("FIELD")].map(field => (field.getAttribute("name") || field.getAttribute("ID") || "").toLowerCase());
    const tableRows = [...doc.querySelectorAll("TABLEDATA TR")];
    return tableRows.map(row => {
      const values = [...row.querySelectorAll("TD")].map(cell => cell.textContent.trim());
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
          const band = timeSafeText(row.band, "Band not listed");
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
      setArchiveStatus("The direct archive query could not be read in this browser (" + error.message + "). You can still run the same coordinate search in IRSA's official SPHEREx Explorer using the button below.", "error");
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
  const dateInputs = ["#date-a-start", "#date-a-end", "#date-b-start", "#date-b-end"].map(selector => document.querySelector(selector));
  const today = new Date().toISOString().slice(0, 10);
  dateInputs.forEach(input => input.max = today);
  dateInputs[0].value = "2025-05-01";
  dateInputs[1].value = "2025-06-01";
  dateInputs[2].value = "2025-11-01";
  dateInputs[3].value = "2025-12-01";

  function timeSafeText(value, fallback = "Not supplied") {
    return value && value !== "null" && value !== "undefined" ? value : fallback;
  }
  function timeParseVOTable(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The archive returned an unreadable table.");
    const fields = [...doc.querySelectorAll("FIELD")].map(field => (field.getAttribute("name") || field.getAttribute("ID") || "").toLowerCase());
    return [...doc.querySelectorAll("TABLEDATA TR")].map(row => {
      const values = [...row.querySelectorAll("TD")].map(cell => cell.textContent.trim());
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
  function appendTimeRecords(target, rows, collection) {
    target.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "time-empty";
      empty.textContent = "No matching observations in this date window.";
      target.append(empty);
      return;
    }
    rows.slice(0, 15).forEach((row, index) => {
      const item = document.createElement("article");
      item.className = "archive-result";
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = timeSafeText(row.obs_id, "Observation " + (index + 1));
      const meta = document.createElement("span");
      const mjd = Number(row.t_min);
      const date = Number.isFinite(mjd) ? new Date((mjd - 40587) * 86400000).toISOString().slice(0,10) : "Date not listed";
      meta.textContent = collection.toUpperCase() + " · " + timeSafeText(row.band, "Band not listed") + " · " + date;
      info.append(name, meta);
      const link = document.createElement("a");
      link.textContent = "Open FITS data ↗";
      link.href = row.access_url || "https://irsa.ipac.caltech.edu/applications/spherex/";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(info, link);
      target.append(item);
    });
  }
  timeForm.addEventListener("submit", async event => {
    event.preventDefault();
    const ra = Number(document.querySelector("#ra-input").value);
    const dec = Number(document.querySelector("#dec-input").value);
    const radius = Number(document.querySelector("#radius-input").value);
    const [aStart,aEnd,bStart,bEnd] = dateInputs.map(input => input.value);
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra > 360 || dec < -90 || dec > 90) {
      timeStatus.textContent = "Enter valid RA and Dec coordinates in the archive search above first.";
      timeStatus.className = "archive-status error";
      return;
    }
    if (dateInputs.some(input => !input.value) || aStart > aEnd || bStart > bEnd || aStart < "2025-05-01" || bStart < "2025-05-01" || aEnd > today || bEnd > today) {
      timeStatus.textContent = "Check the dates: start must be before end, dates must be from 1 May 2025 onwards, and not in the future.";
      timeStatus.className = "archive-status error";
      return;
    }
    if (!(aEnd < bStart || bEnd < aStart)) {
      timeStatus.textContent = "Choose two separate date windows so Period A and Period B do not overlap.";
      timeStatus.className = "archive-status error";
      return;
    }
    document.querySelector("#period-a-label").textContent = dateLabel(aStart) + " – " + dateLabel(aEnd);
    document.querySelector("#period-b-label").textContent = dateLabel(bStart) + " – " + dateLabel(bEnd);
    const outputA = document.querySelector("#period-a-results");
    const outputB = document.querySelector("#period-b-results");
    outputA.replaceChildren(); outputB.replaceChildren();
    timeButton.disabled = true;
    timeButton.textContent = "Comparing…";
    timeStatus.textContent = "Searching SPHEREx DR1 and QR3 for both time windows…";
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
      return resultSets.flatMap(set => set.rows.map(row => ({row, collection:set.collection})));
    }
    try {
      const [a,b] = await Promise.all([queryWindow(aStart,aEnd),queryWindow(bStart,bEnd)]);
      appendTimeRecords(outputA,a.map(x=>x.row),"DR1 / QR3");
      appendTimeRecords(outputB,b.map(x=>x.row),"DR1 / QR3");
      // Replace generic collection labels with the actual release for each result row.
      [ [outputA,a], [outputB,b] ].forEach(([container,sets]) => {
        const links=[...container.querySelectorAll(".archive-result")];
        links.forEach((item,index) => { const meta=item.querySelector("span"); if(meta && sets[index]) meta.textContent=sets[index].collection.toUpperCase()+" · "+timeSafeText(sets[index].row.band,"Band not listed")+" · "+(Number.isFinite(Number(sets[index].row.t_min))?new Date((Number(sets[index].row.t_min)-40587)*86400000).toISOString().slice(0,10):"Date not listed"); });
      });
      timeStatus.textContent = "Comparison complete: " + a.length + " observation(s) in Period A and " + b.length + " in Period B. Compare their dates and bands, then open the original FITS data to inspect each observation.";
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
