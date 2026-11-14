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
document.querySelectorAll(".popular-searches [data-query]").forEach(button => button.addEventListener("click", () => {
  searchInput.value = button.dataset.query;
  activeTopic = "all";
  chips.forEach(chip => chip.classList.toggle("active", chip.dataset.topic === "all"));
  filterCards();
  document.querySelector("#object-grid").scrollIntoView({behavior:"smooth",block:"start"});
}));
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
    const all = name => [...doc.getElementsByTagNameNS("*", name)];
    return all("TR").filter(row => row.parentElement && row.parentElement.localName.toLowerCase() === "tabledata").map(row => {
      let table = row.parentElement;
      while (table && table.localName.toLowerCase() !== "table") table = table.parentElement;
      const fields = table ? [...table.getElementsByTagNameNS("*", "FIELD")].map(field => (field.getAttribute("name") || field.getAttribute("ID") || "").toLowerCase()) : [];
      const values = [...row.children].filter(cell => cell.localName.toLowerCase() === "td").map(cell => cell.textContent.trim());
      return Object.fromEntries(fields.map((field, index) => [field, values[index] || ""]));
    });
  }

  function safeText(value, fallback = "Not supplied") {
    return value && value !== "null" && value !== "undefined" ? value : fallback;
  }

  function buildExplorerUrl() {
    const ra = Number(document.querySelector("#ra-input").value);
    const dec = Number(document.querySelector("#dec-input").value);
    const radius = Number(document.querySelector("#radius-input").value);
    if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90 ||
        !Number.isFinite(radius) || radius <= 0) return null;
    const url = new URL("https://irsa.ipac.caltech.edu/applications/spherex/");
    url.search = new URLSearchParams({
      api: "spectral-images",
      ra: String(ra),
      dec: String(dec),
      sr: radius + "d"
    }).toString();
    return url;
  }

  archiveForm.addEventListener("submit", event => {
    event.preventDefault();
    const explorerUrl = buildExplorerUrl();
    if (!explorerUrl) {
      setArchiveStatus("Please enter valid J2000 coordinates and a search radius.", "error");
      return;
    }
    fallbackLink.href = explorerUrl.href;
    setArchiveStatus("Opening NASA/IPAC IRSA's official SPHEREx Data Explorer with your coordinates. Choose the data release and inspect available observations there.", "success");
    window.open(explorerUrl.href, "_blank", "noopener,noreferrer");
  });

  ["ra-input","dec-input","radius-input"].forEach(id => {
    document.querySelector("#" + id).addEventListener("change", () => {
      const url = buildExplorerUrl();
      if (url) fallbackLink.href = url.href;
    });
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
  galaxies: {kicker:"01 / GALAXIES",title:"Galaxies",description:"Galaxies are enormous systems of stars, gas, dust and dark matter. Explore nearby examples such as Andromeda (M31) and our own Milky Way.",fact:"SPHEREx maps the sky in 102 near-infrared bands to study galaxies and their history. Its broad spectral survey helps scientists investigate the light from millions of galaxies.",image:"https://images-assets.nasa.gov/image/PIA04921/PIA04921~medium.jpg",credit:"Andromeda Galaxy · NASA/JPL-Caltech · GALEX ultraviolet view",source:"https://science.nasa.gov/photojournal/andromeda-galaxy/",targets:[{name:"Andromeda Galaxy",ra:"10.6847",dec:"41.2690"},{name:"Milky Way Galactic Centre",ra:"266.4168",dec:"-29.0078"}]},
  nebulae: {kicker:"02 / NEBULAE",title:"Nebulae",description:"Nebulae are clouds of gas and dust. Some are stellar nurseries; others are material released by stars late in their lives.",fact:"Infrared light can reveal structures within dusty regions. SPHEREx provides a wide-sky infrared view, although its archive search does not automatically classify a nebula.",image:"https://science.nasa.gov/wp-content/uploads/2023/09/web-first-images-release.png",credit:"Webb Reveals the Carina Nebula · NASA, ESA, CSA, STScI",source:"https://science.nasa.gov/image-detail/web-first-images-release/",targets:[{name:"Orion Nebula",ra:"83.8221",dec:"-5.3911"},{name:"Carina Nebula",ra:"161.05",dec:"-60.266"}]},
  stars: {kicker:"03 / STARS",title:"Stars & clusters",description:"Stars are luminous spheres of plasma. Star clusters group stars that formed in related environments and help astronomers study stellar evolution.",fact:"SPHEREx observes stars across many near-infrared bands. The resulting spectral information helps scientists study stellar populations and material around them.",image:"",credit:"",source:"https://science.nasa.gov/universe/stars/",targets:[{name:"Pleiades star cluster",ra:"56.75",dec:"24.1167"},{name:"Orion Nebula star-forming region",ra:"83.8221",dec:"-5.3911"}]},
  "brown-dwarfs": {kicker:"04 / BROWN DWARFS",title:"Brown dwarfs",description:"Brown dwarfs are objects that are more massive than most planets but do not sustain ordinary hydrogen fusion like stars.",fact:"Their cool atmospheres emit strongly in infrared wavelengths, making infrared surveys useful for finding and studying them. A coordinate search alone does not identify a brown dwarf.",image:"",credit:"",source:"https://science.nasa.gov/universe/stars/",targets:[{name:"Pleiades region",ra:"56.75",dec:"24.1167"}]},
  dust: {kicker:"05 / COSMIC DUST",title:"Cosmic dust",description:"Cosmic dust consists of tiny solid grains between stars. It absorbs and scatters some light and can help provide material for new stars and planets.",fact:"Infrared observations can reveal thermal emission from dust and help map dusty environments across the sky.",image:"",credit:"",source:"https://science.nasa.gov/universe/",targets:[{name:"Orion Nebula",ra:"83.8221",dec:"-5.3911"},{name:"Carina Nebula",ra:"161.05",dec:"-60.266"}]},
  "star-forming": {kicker:"06 / STAR FORMATION",title:"Star-forming regions",description:"Stars form inside dense clouds of gas and dust. Young stars can reshape their surroundings with radiation and stellar winds.",fact:"SPHEREx's all-sky infrared spectral survey helps scientists study the molecules and dusty environments associated with star formation.",image:"https://science.nasa.gov/wp-content/uploads/2023/09/web-first-images-release.png",credit:"Carina Nebula · NASA, ESA, CSA, STScI · Webb infrared image",source:"https://science.nasa.gov/image-detail/web-first-images-release/",targets:[{name:"Carina Nebula",ra:"161.05",dec:"-60.266"},{name:"Orion Nebula",ra:"83.8221",dec:"-5.3911"}]},
  cosmology: {kicker:"07 / DEEP UNIVERSE",title:"The deep universe",description:"Distant galaxies let astronomers look back through cosmic history and trace how large-scale structure developed.",fact:"One of SPHEREx's major goals is to map millions of galaxies and investigate the history of the universe, including the physics of cosmic inflation.",image:"",credit:"",source:"https://science.nasa.gov/universe/",targets:[{name:"Andromeda Galaxy",ra:"10.6847",dec:"41.2690"}]}
};
const topicDialog = document.querySelector("#topic-dialog");
if (topicDialog) {
  const title = document.querySelector("#topic-dialog-title");
  const kicker = document.querySelector("#topic-dialog-kicker");
  const description = document.querySelector("#topic-dialog-description");
  const fact = document.querySelector("#topic-dialog-fact");
  const dialogImage = document.querySelector("#topic-dialog-image");
  const dialogCredit = document.querySelector("#topic-dialog-credit");
  const dialogExamples = document.querySelector("#topic-dialog-examples");
  const nasaLink = document.querySelector("#topic-dialog-nasa");
  let activeTopicDetail = null;
  const closeDialog = () => topicDialog.close();
  cards.forEach(card => {
    card.addEventListener("click", () => {
      const detail = topicDetails[card.dataset.category];
      if (!detail) return;
      activeTopicDetail = detail;
      kicker.textContent = detail.kicker;
      title.textContent = detail.title;
      description.textContent = detail.description;
      fact.textContent = detail.fact;
      dialogImage.hidden = !detail.image;
      dialogImage.src = detail.image || "";
      dialogImage.alt = detail.image ? detail.title + " NASA image" : "";
      dialogCredit.hidden = !detail.credit;
      dialogCredit.textContent = detail.credit || "";
      nasaLink.href = detail.source;
      dialogExamples.replaceChildren();
      detail.targets.forEach(target => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "topic-target-chip";
        button.textContent = target.name;
        button.addEventListener("click", () => selectTarget(target));
        dialogExamples.append(button);
      });
      topicDialog.showModal();
    });
  });
  function selectTarget(target) {
    document.querySelector("#ra-input").value = target.ra;
    document.querySelector("#dec-input").value = target.dec;
    document.querySelector("#radius-input").value = "0.1";
    document.querySelector("#target-name").value = target.name;
    document.querySelector("#target-ra").textContent = target.ra;
    document.querySelector("#target-dec").textContent = target.dec;
    document.querySelector("#target-radius").textContent = "6 arcmin";
    closeDialog();
    document.querySelector("#archive-form").scrollIntoView({behavior:"smooth",block:"center"});
    document.querySelector("#archive-status").textContent = target.name + " coordinates loaded. Press Search SPHEREx to query real archive observations.";
    document.querySelector("#archive-status").className = "archive-status";
  }
  document.querySelector("#topic-dialog-explore").addEventListener("click", () => {
    if (activeTopicDetail && activeTopicDetail.targets[0]) selectTarget(activeTopicDetail.targets[0]);
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
  let discoveredPosition = "";

  function timeSafeText(value, fallback = "Not supplied") {
    return value && value !== "null" && value !== "undefined" ? value : fallback;
  }
  function timeParseVOTable(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The archive returned an unreadable table.");
    const all = name => [...doc.getElementsByTagNameNS("*", name)];
    return all("TR").filter(row => row.parentElement && row.parentElement.localName.toLowerCase() === "tabledata").map(row => {
      let table = row.parentElement;
      while (table && table.localName.toLowerCase() !== "table") table = table.parentElement;
      const fields = table ? [...table.getElementsByTagNameNS("*", "FIELD")].map(field => (field.getAttribute("name") || field.getAttribute("ID") || "").toLowerCase()) : [];
      const values = [...row.children].filter(cell => cell.localName.toLowerCase() === "td").map(cell => cell.textContent.trim());
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
  const loadingFacts = document.querySelector("#archive-loading-facts");
  const loadingFact = document.querySelector("#archive-loading-fact");
  const loadingFactDeck = [
    "SPHEREx maps the entire sky in 102 near-infrared wavelength bands.",
    "Its wavelength coverage runs from about 0.75 to 5 micrometres.",
    "The mission studies galaxies, cosmic history, and the ingredients for life.",
    "SPHEREx launched in March 2025 and began nominal science operations in May 2025.",
    "IRSA receives new SPHEREx data on an approximately weekly basis.",
    "A single sky position can be observed in different wavelength bands and at different times."
  ];
  let loadingFactTimer = null;
  let loadingFactIndex = 0;
  function startArchiveLoadingFacts() {
    if (!loadingFacts || !loadingFact) return;
    loadingFactIndex = 0;
    loadingFact.textContent = loadingFactDeck[loadingFactIndex];
    loadingFacts.hidden = false;
    loadingFactTimer = window.setInterval(() => {
      loadingFactIndex = (loadingFactIndex + 1) % loadingFactDeck.length;
      loadingFact.classList.add("fact-changing");
      window.setTimeout(() => {
        loadingFact.textContent = loadingFactDeck[loadingFactIndex];
        loadingFact.classList.remove("fact-changing");
      }, 180);
    }, 4200);
  }
  function stopArchiveLoadingFacts() {
    if (loadingFactTimer !== null) window.clearInterval(loadingFactTimer);
    loadingFactTimer = null;
    if (loadingFacts) loadingFacts.hidden = true;
  }

  const loadMoreDatesButton = document.querySelector("#load-more-dates");
  let archiveMaxRecords = 10;
  let loadMoreRequested = false;
  if (loadMoreDatesButton) {
    loadMoreDatesButton.addEventListener("click", () => {
      archiveMaxRecords = Math.min(100, archiveMaxRecords + 10);
      loadMoreRequested = true;
      loadMoreDatesButton.disabled = true;
      discoverButton.click();
    });
  }
  discoverButton.addEventListener("click", async () => {
    if (!loadMoreRequested) archiveMaxRecords = 10;
    loadMoreRequested = false;
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
    timeStatus.textContent = "Querying the SPHEREx observation catalogue…";
    timeStatus.className = "archive-status";
    startArchiveLoadingFacts();
    try {
      const url = new URL("/api/spherex", window.location.origin);
      url.search = new URLSearchParams({ra:String(ra),dec:String(dec),radius:String(radius),collection:document.querySelector("#collection-input")?.value || "spherex_qr3",maxrec:String(archiveMaxRecords)}).toString();
      const response = await fetch(url, {signal: AbortSignal.timeout(32000)});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || "Archive query failed.");
      const records = (payload.results || []).flatMap(result => timeParseVOTable(result.xml));      if (loadMoreDatesButton) {
        loadMoreDatesButton.hidden = records.length < archiveMaxRecords || archiveMaxRecords >= 100;
        loadMoreDatesButton.disabled = false;
      }
      const unique = new Map();
      records.forEach(row => {
        const candidates = [row.t_min,row.t_max,row.mjd_obs,row.obs_mjd,row.date_obs,row.obs_date,row.date].filter(value => value !== undefined && value !== null && String(value).trim() !== "");
        let date = "";
        for (const raw of candidates) {
          const value = String(raw).trim();
          const numeric = Number(value);
          if (Number.isFinite(numeric) && numeric >= 40000 && numeric <= 100000) {
            date = new Date((numeric - 40587) * 86400000).toISOString().slice(0,10);
            break;
          }
          const parsed = Date.parse(value);
          if (Number.isFinite(parsed)) {
            date = new Date(parsed).toISOString().slice(0,10);
            break;
          }
        }
        if (date && date >= "2025-05-01" && date <= today) unique.set(date, date);
      });
      discoveredDates = [...unique.keys()].sort();
      discoveredPosition = [ra, dec, radius].join("|");
      fillDateSelect(dateA, discoveredDates, discoveredDates[0]);
      fillDateSelect(dateB, discoveredDates, discoveredDates.length > 1 ? discoveredDates[discoveredDates.length - 1] : discoveredDates[0]);
      timeButton.disabled = discoveredDates.length < 2;
      dateA.disabled = discoveredDates.length === 0;
      dateB.disabled = discoveredDates.length === 0;
      if (discoveredDates.length >= 2) {
        timeStatus.textContent = "Found " + records.length + " archive record(s) across " + discoveredDates.length + " distinct observation date(s). Choose two dates to compare." + (payload.errors && payload.errors.length ? " Some archive collections did not respond, so the date list may be incomplete." : "");
        timeStatus.className = "archive-status success";
      } else if (discoveredDates.length === 1) {
        timeStatus.textContent = "The archive returned observations on only one distinct date for this position. A date-to-date comparison needs at least two dates.";
        timeStatus.className = "archive-status";
      } else {
        timeStatus.textContent = payload.errors && payload.errors.length
          ? "The date search was incomplete because an archive collection failed. Please retry before concluding there are no observations."
          : "No dated observations were returned for this position. Try a wider search radius or another sky position.";
        timeStatus.className = "archive-status";
      }
    } catch (error) {
      if (loadMoreDatesButton) loadMoreDatesButton.disabled = false;
      timeStatus.textContent = error.name === "TimeoutError" || error.name === "AbortError" ? "The SPHEREx archive is taking too long to respond. Try again in a moment; this is not a zero-observation result." : "Could not discover observation dates: " + error.message;
      timeStatus.className = "archive-status error";
    } finally {
      stopArchiveLoadingFacts();
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
    placeholder.textContent = "Loading your selected SPHEREx image…";
    status.textContent = "Retrieving FITS cutout from IRSA…";
    try {
      const url = new URL("/api/spherex-image", window.location.origin);
      url.search = new URLSearchParams({
        url: row.access_url,
        ra: String(ra),
        dec: String(dec),
        size: String(Math.min(0.05, Math.max(0.03, radius)))
      }).toString();
      const response = await fetch(url, {signal: AbortSignal.timeout(52000)});
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
      preview.textContent = "View sky image";
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
      status.textContent = "Checking the selected SPHEREx release without a date filter…";
      status.className = "archive-status";
      try {
        const url = new URL("/api/spherex", window.location.origin);
        url.search = new URLSearchParams({ra:String(ra),dec:String(dec),radius:String(radius),collection:document.querySelector("#collection-input")?.value || "spherex_qr3",maxrec:"12"}).toString();
        const response = await fetch(url,{signal:AbortSignal.timeout(23000)});
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || "Archive proxy failed");
        const sets = (payload.results || []).map(result => ({collection:result.collection,rows:parseVOTable(result.xml)}));
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
    if (discoveredPosition !== [ra, dec, radius].join("|")) {
      timeStatus.textContent = "The sky position or search radius has changed. Discover available dates again for the current coordinates.";
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
    try {
      const url = new URL("/api/spherex", window.location.origin);
      url.search = new URLSearchParams({
        ra:String(ra), dec:String(dec), radius:String(radius),
        startA:String(dateToMJD(aDate)), endA:String(dateToMJD(aDate,true)),
        startB:String(dateToMJD(bDate)), endB:String(dateToMJD(bDate,true)),
        collection:document.querySelector("#collection-input")?.value || "spherex_qr3",
        maxrec:"30"
      }).toString();
      timeStatus.textContent = "Running one combined archive query for both dates…";
      const response = await fetch(url,{signal:AbortSignal.timeout(23000)});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || "Archive proxy failed");
      const records = (payload.results || []).flatMap(result => timeParseVOTable(result.xml).map(row=>({...row,_collection:result.collection})));
      const overlaps = (row,date) => {
        const lower=Number(row.t_min), upper=Number(row.t_max || row.t_min);
        const lo=dateToMJD(date), hi=dateToMJD(date,true);
        return Number.isFinite(lower) && lower<=hi && Number.isFinite(upper) && upper>=lo;
      };
      const uniqueRows = rows => [...new Map(rows.map(row=>[[row._collection,row.obs_id||"",row.access_url||"",row.t_min||""].join("|"),row])).values()];
      const a=uniqueRows(records.filter(row=>overlaps(row,aDate)));
      const b=uniqueRows(records.filter(row=>overlaps(row,bDate)));
      appendTimeRecords(outputA,a,"SPHEREx archive");
      appendTimeRecords(outputB,b,"SPHEREx archive");
      if (a.length) setImageMessage("a", "Comparison ready. Tap View sky image on a Period A observation below to load its FITS cutout.");
      else setImageMessage("a", "No matching observation image in Period A.");
      if (b.length) setImageMessage("b", "Comparison ready. Tap View sky image on a Period B observation below to load its FITS cutout.");
      else setImageMessage("b", "No matching observation image in Period B.");
      [[outputA,a],[outputB,b]].forEach(([container,rows])=>{
        [...container.querySelectorAll(".archive-result")].forEach((item,index)=>{
          const row=rows[index], meta=item.querySelector("span");
          if(meta&&row) meta.textContent=row._collection.toUpperCase()+" · "+timeSafeText(row.band,"Band not listed")+" · "+(Number.isFinite(Number(row.t_min))?new Date((Number(row.t_min)-40587)*86400000).toISOString().slice(0,10):"Date not listed");
        });
      });
      timeStatus.textContent="Comparison ready: "+a.length+" observation(s) in Period A and "+b.length+" in Period B. One combined archive query was used; images load only when requested.";
      timeStatus.className="archive-status success";
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


/* COSMOS Discovery Lab: visual comparison and clearly labelled learning tools. */
(() => {
  const byId = id => document.getElementById(id);
  const imageA = byId("image-a"), imageB = byId("image-b");
  if (!imageA || !imageB || !byId("sky-lab")) return;
  const blinkA = byId("blink-a"), blinkB = byId("blink-b");
  const blinkStatus = byId("blink-status");
  const wipeCanvas = byId("wipe-canvas"), wipeRange = byId("wipe-range");
  let blinkPeriod = "a", blinkTimer = null;

  function hasImage(canvas) { return canvas.width > 0 && canvas.height > 0; }
  function syncLab() {
    const ready = hasImage(imageA) && hasImage(imageB);
    blinkA.disabled = blinkB.disabled = !ready;
    wipeRange.disabled = !ready;
    byId("wipe-empty").hidden = ready;
    if (ready) drawWipe();
    else { wipeCanvas.width = 0; wipeCanvas.height = 0; }
    if (!ready) blinkStatus.textContent = "Load both FITS previews to activate the blink comparator.";
  }
  function showPeriod(which) {
    blinkPeriod = which;
    const panes = document.querySelector(".image-panes");
    panes.classList.toggle("blink-show-a", which === "a");
    panes.classList.toggle("blink-show-b", which === "b");
    blinkStatus.textContent = "Currently highlighting Period " + which.toUpperCase() + ".";
  }
  blinkA.addEventListener("click", () => showPeriod("a"));
  blinkB.addEventListener("click", () => showPeriod("b"));
  function drawWipe() {
    if (!hasImage(imageA) || !hasImage(imageB)) return;
    const width = Math.max(imageA.width,imageB.width), height = Math.max(imageA.height,imageB.height);
    wipeCanvas.width = width; wipeCanvas.height = height;
    const ctx = wipeCanvas.getContext("2d");
    ctx.fillStyle = "#05070c"; ctx.fillRect(0,0,width,height);
    ctx.drawImage(imageB,0,0,width,height);
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,width*Number(wipeRange.value)/100,height); ctx.clip();
    ctx.drawImage(imageA,0,0,width,height); ctx.restore();
    const x=width*Number(wipeRange.value)/100;
    ctx.strokeStyle="#ffd27a";ctx.lineWidth=Math.max(2,width/300);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();
  }
  wipeRange.addEventListener("input",drawWipe);
  const observer = new MutationObserver(syncLab);
  observer.observe(imageA,{attributes:true,attributeFilter:["width","height"]});
  observer.observe(imageB,{attributes:true,attributeFilter:["width","height"]});
  const originalPutImageData = CanvasRenderingContext2D.prototype.putImageData;
  // Poll-free refresh after the FITS canvases have rendered: their image status changes.
  ["image-a-status","image-b-status"].forEach(id => {
    const node=byId(id); if(node) new MutationObserver(syncLab).observe(node,{childList:true,characterData:true,subtree:true});
  });
  window.addEventListener("resize",drawWipe);
  const dates = () => [...byId("date-a").options].map(o=>o.value).filter(Boolean);
  const timeline = byId("timeline-range");
  const timelineReadout = byId("timeline-readout");
  function updateTimeline() {
    const list=dates();
    timeline.max=Math.max(0,list.length-1);
    timeline.disabled=list.length===0;
    if(list.length){timeline.value=list.length-1;timelineReadout.textContent="Selected archive date: "+list[Number(timeline.value)];}
    else timelineReadout.textContent="Discover dates to build your timeline.";
    byId("timeline-compare").disabled=list.length<2;
  }
  timeline.addEventListener("input",()=>{
    const list=dates(), date=list[Number(timeline.value)];
    if(date) timelineReadout.textContent="Selected archive date: "+date;
  });
  byId("timeline-compare").addEventListener("click",()=>{
    const list=dates(), date=list[Number(timeline.value)];
    if(!date) return;
    byId("date-b").value=date;
    byId("time-status").textContent="Period B set to "+date+". Press Compare observations to load its archive records.";
    byId("time-status").className="archive-status";
    byId("time-compare-form").scrollIntoView({behavior:"smooth",block:"center"});
  });
  const dateObserver=new MutationObserver(updateTimeline);
  dateObserver.observe(byId("date-a"),{childList:true});
  byId("date-a").addEventListener("change",updateTimeline);


  drawSpectrum();window.addEventListener("resize",drawSpectrum);

  function refreshTarget(){
    byId("target-ra").textContent=byId("ra-input").value||"—";
    byId("target-dec").textContent=byId("dec-input").value||"—";
    byId("target-radius").textContent=byId("radius-input").selectedOptions[0]?.textContent||"—";
  }
  byId("refresh-target").addEventListener("click",refreshTarget);
  ["ra-input","dec-input","radius-input"].forEach(id=>byId(id).addEventListener("change",refreshTarget));
  refreshTarget();
  const storageKey="cosmos-discovery-log-v1";
  function readLog(){try{return JSON.parse(localStorage.getItem(storageKey)||"[]").slice(0,20);}catch{return [];}}
  function renderLog(){
    const list=byId("discovery-list");list.replaceChildren();
    readLog().forEach(entry=>{
      const card=document.createElement("div");card.className="discovery-entry";
      const note=document.createElement("div");note.textContent=entry.note;
      const meta=document.createElement("small");meta.textContent=entry.name+" · RA "+entry.ra+" · Dec "+entry.dec+" · "+entry.date;
      card.append(note,meta);list.append(card);
    });
  }
  byId("save-discovery").addEventListener("click",()=>{
    const note=byId("discovery-note").value.trim();
    if(!note){byId("discovery-status").textContent="Add a short observation note first.";return;}
    const entry={note,name:byId("target-name").value.trim()||"Unnamed sky region",ra:byId("ra-input").value||"—",dec:byId("dec-input").value||"—",date:new Date().toLocaleString()};
    const log=readLog();log.unshift(entry);
    try{localStorage.setItem(storageKey,JSON.stringify(log.slice(0,20)));byId("discovery-note").value="";byId("discovery-status").textContent="Saved in this browser. You can revisit this log on this device.";renderLog();}
    catch{byId("discovery-status").textContent="This browser could not save the log. Check its local storage settings.";}
  });
  renderLog();
  // Keep the wipe and blink tools in sync whenever a preview canvas is cleared or drawn.
  const imageStatusObserver=new MutationObserver(syncLab);
  [byId("image-a-status"),byId("image-b-status")].forEach(node=>node&&imageStatusObserver.observe(node,{childList:true,characterData:true,subtree:true}));
  syncLab();updateTimeline();
})();
