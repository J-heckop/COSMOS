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
      const collections = ["spherex_dr1", "spherex_qr3"];
      const responses = await Promise.all(collections.map(async collection => {
        const url = new URL("https://irsa.ipac.caltech.edu/SIA");
        url.search = new URLSearchParams({COLLECTION:collection, POS:"CIRCLE " + ra + " " + dec + " " + radius, RESPONSEFORMAT:"VOTABLE"}).toString();
        const response = await fetch(url, {headers:{Accept:"application/x-votable+xml, application/xml, text/xml"}});
        if (!response.ok) throw new Error("IRSA returned HTTP " + response.status);
        return {collection, rows:parseVOTable(await response.text())};
      }));
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
