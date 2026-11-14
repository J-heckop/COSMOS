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