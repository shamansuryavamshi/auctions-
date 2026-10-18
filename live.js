// =======================
// LOAD DATA
// =======================
let teams = JSON.parse(localStorage.getItem("teams")) || [];
let players = JSON.parse(localStorage.getItem("players")) || [];

teams.forEach(team => {
  if (!Array.isArray(team.playersBought)) {
    team.playersBought = [];
  }
});

// =======================
// AUCTION STATE
// =======================
let currentPlayerIndex = 0;
let highestBid = 0;
let leadingTeamIndex = -1;

// =======================
// DOM REFERENCES
// =======================
const teamsList = document.getElementById("teams-list");
const playersList = document.getElementById("players-list");
const teamSelect = document.getElementById("team-select");

const auctionPlayerImage = document.getElementById("auction-player-image");
const auctionPlayerName = document.getElementById("auction-player-name");
const auctionPlayerCategory = document.getElementById("auction-player-category");

const bidAmount = document.getElementById("bid-amount");
const placeBidBtn = document.getElementById("place-bid");
const sellPlayerBtn = document.getElementById("sell-player");

const highestBidSpan = document.getElementById("highest-bid");
const leadingTeamSpan = document.getElementById("leading-team");
const soldPlayersTbody = document.getElementById("sold-players");

// popup elements
const popup = document.getElementById("info-popup");
const popupTitle = document.getElementById("popup-title");
const popupList = document.getElementById("popup-list");
const popupImage = document.getElementById("popup-image");
const closePopup = document.getElementById("close-popup");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");

// popup state
let currentPopupIndex = 0;
let popupMode = ""; // "player" | "team"

// end auction button
const endAuctionBtn = document.getElementById("end-auction-btn");

// =======================
// TEAM SELECT
// =======================
function populateTeamSelect() {
  teamSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.textContent = "Select Team";
  defaultOption.value = "";
  defaultOption.disabled = true;
  defaultOption.selected = true;
  teamSelect.appendChild(defaultOption);

  teams.forEach((team, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = team.name;
    teamSelect.appendChild(option);
  });

  placeBidBtn.disabled = true;
}

teamSelect.addEventListener("change", () => {
  placeBidBtn.disabled = teamSelect.value === "";
});

// =======================
// UPDATE AUCTION DISPLAY ✅ shows 1st player immediately
// =======================
function updateCurrentPlayerDisplay() {
  if (players.length === 0) {
    auctionPlayerImage.style.display = "none";
    auctionPlayerImage.src = "";
    auctionPlayerName.textContent = "Auction Finished";
    auctionPlayerCategory.textContent = "—";
    highestBidSpan.textContent = "0";
    leadingTeamSpan.textContent = "—";
    return;
  }

  const player = players[currentPlayerIndex];

  // ✅ show base64 image ONLY (no fakepath)
  if (player.image && typeof player.image === "string" && player.image.startsWith("data:image")) {
    auctionPlayerImage.src = player.image;
    auctionPlayerImage.style.display = "block";
  } else {
    auctionPlayerImage.style.display = "none";
    auctionPlayerImage.src = "";
  }

  auctionPlayerName.textContent = player.name;
  auctionPlayerCategory.textContent = player.type;

  highestBidSpan.textContent = highestBid;
  leadingTeamSpan.textContent =
    leadingTeamIndex >= 0 ? teams[leadingTeamIndex].name : "—";
}

// =======================
// RENDER TEAMS
// =======================
function renderTeams() {
  teamsList.innerHTML = "";

  teams.forEach((team, index) => {
    const div = document.createElement("div");
    div.className = "team-card";
    div.dataset.index = index;

    div.innerHTML = `
      <h3>${team.name}</h3>
      <p>Budget: ₹${team.budget}</p>
      <button class="remove-team-btn" data-index="${index}">Remove</button>
    `;

    teamsList.appendChild(div);
  });
}

// =======================
// RENDER PLAYERS POOL
// =======================
function renderPlayers() {
  playersList.innerHTML = "";

  players.forEach((player, index) => {
    const div = document.createElement("div");
    div.className = "player-card";
    div.dataset.index = index;

    div.innerHTML = `
      <h3>${player.name}</h3>
      <p>Category: ${player.type}</p>
      <button class="remove-player-btn" data-index="${index}">Remove</button>
    `;

    playersList.appendChild(div);
  });
}

// =======================
// RENDER SOLD PLAYERS
// =======================
function renderSoldPlayers() {
  soldPlayersTbody.innerHTML = "";

  teams.forEach(team => {
    team.playersBought.forEach(player => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${player.name}</td>
        <td>${player.type}</td>
        <td>${team.name}</td>
        <td>₹${player.price}</td>
      `;
      soldPlayersTbody.appendChild(row);
    });
  });
}

// =======================
// PLAYER POPUP
// =======================
function renderPlayerPopup(index) {
  const player = players[index];
  if (!player) return;

  popupMode = "player";
  currentPopupIndex = index;

  popupTitle.textContent = player.name;

  if (typeof player.image === "string" && player.image.startsWith("data:image")) {
    popupImage.src = player.image;
    popupImage.style.display = "block";
  } else {
    popupImage.style.display = "none";
    popupImage.src = "";
  }

  popupList.innerHTML = `
    <li>Category: ${player.type}</li>
    <li>Status: Available</li>
  `;

  popup.classList.remove("hidden");
}

// =======================
// TEAM POPUP
// =======================
function renderTeamPopup(index) {
  const team = teams[index];
  if (!team) return;

  popupMode = "team";
  currentPopupIndex = index;

  popupTitle.textContent = `${team.name} — ₹${team.budget}`;

  popupImage.style.display = "none";
  popupImage.src = "";

  popupList.innerHTML = "";

  if (team.playersBought.length === 0) {
    popupList.innerHTML = "<li>No players bought yet</li>";
  } else {
    team.playersBought.forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${p.name} (${p.type}) — ₹${p.price}`;
      popupList.appendChild(li);
    });
  }

  popup.classList.remove("hidden");
}

// =======================
// CLICK HANDLING (REMOVE + POPUPS)
// =======================
playersList.addEventListener("click", e => {
  // remove player
  if (e.target.classList.contains("remove-player-btn")) {
    players.splice(Number(e.target.dataset.index), 1);
    localStorage.setItem("players", JSON.stringify(players));

    renderPlayers();

    if (currentPlayerIndex >= players.length) currentPlayerIndex = 0;
    updateCurrentPlayerDisplay();
    return;
  }

  // open player popup
  const card = e.target.closest(".player-card");
  if (!card) return;

  renderPlayerPopup(Number(card.dataset.index));
});

teamsList.addEventListener("click", e => {
  // remove team
  if (e.target.classList.contains("remove-team-btn")) {
    teams.splice(Number(e.target.dataset.index), 1);
    localStorage.setItem("teams", JSON.stringify(teams));

    populateTeamSelect();
    renderTeams();
    updateCurrentPlayerDisplay();
    return;
  }

  // open team popup
  const card = e.target.closest(".team-card");
  if (card) renderTeamPopup(Number(card.dataset.index));
});

// =======================
// PREV / NEXT (PLAYER POPUP ONLY)
// =======================
prevBtn.addEventListener("click", () => {
  if (popupMode !== "player" || players.length === 0) return;

  const prev = (currentPopupIndex - 1 + players.length) % players.length;
  renderPlayerPopup(prev);
});

nextBtn.addEventListener("click", () => {
  if (popupMode !== "player" || players.length === 0) return;

  const next = (currentPopupIndex + 1) % players.length;
  renderPlayerPopup(next);
});

// =======================
// AUCTION ACTIONS
// =======================
placeBidBtn.addEventListener("click", () => {
  if (teamSelect.value === "") {
    alert("Select a team first");
    return;
  }

  const teamIndex = Number(teamSelect.value);
  const bid = Number(bidAmount.value);

  if (isNaN(bid) || bid <= highestBid) {
    alert("Bid must be higher than current highest bid");
    return;
  }

  if (teams[teamIndex].budget < bid) {
    alert("Team does not have enough budget");
    return;
  }

  highestBid = bid;
  leadingTeamIndex = teamIndex;

  updateCurrentPlayerDisplay();
  bidAmount.value = "";
});

sellPlayerBtn.addEventListener("click", () => {
  if (highestBid === 0 || leadingTeamIndex === -1) {
    alert("Cannot sell player without a valid bid");
    return;
  }

  if (players.length === 0) return;

  const player = players[currentPlayerIndex];
  const team = teams[leadingTeamIndex];

  team.playersBought.push({
    name: player.name,
    type: player.type,
    image: player.image,
    price: highestBid
  });

  team.budget -= highestBid;

  // remove current player from auction pool
  players.splice(currentPlayerIndex, 1);

  // reset for next auction
  highestBid = 0;
  leadingTeamIndex = -1;
  bidAmount.value = "";

  if (currentPlayerIndex >= players.length) currentPlayerIndex = 0;

  localStorage.setItem("teams", JSON.stringify(teams));
  localStorage.setItem("players", JSON.stringify(players));

  renderTeams();
  renderPlayers();
  renderSoldPlayers();
  updateCurrentPlayerDisplay();
});

// =======================
// CLOSE POPUP
// =======================
closePopup.addEventListener("click", () => popup.classList.add("hidden"));
popup.addEventListener("click", e => {
  if (e.target === popup) popup.classList.add("hidden");
});

// =======================
// END AUCTION
// =======================
if (endAuctionBtn) {
  endAuctionBtn.addEventListener("click", () => {
    if (teams.length === 0) {
      alert("No teams available");
      return;
    }

    if (teams.every(t => t.playersBought.length === 0)) {
      alert("No players were sold");
      return;
    }

    // ✅ CLEAR LIVE PAGE UI (DON'T DELETE STORAGE)
    teamsList.innerHTML = "";
    playersList.innerHTML = "";
    soldPlayersTbody.innerHTML = "";

    auctionPlayerImage.style.display = "none";
    auctionPlayerImage.src = "";
    auctionPlayerName.textContent = "Auction Ended";
    auctionPlayerCategory.textContent = "—";

    highestBidSpan.textContent = "0";
    leadingTeamSpan.textContent = "—";

    // ✅ go to conclusion page after clearing UI
    window.location.href = "conclusion.html";
  });
}


// =======================
// INIT ✅ FIRST PLAYER SHOWS IMMEDIATELY
// =======================
populateTeamSelect();
renderTeams();
renderPlayers();
renderSoldPlayers();
updateCurrentPlayerDisplay();
