// =======================
// LOAD DATA
// =======================
const teams = JSON.parse(localStorage.getItem("teams")) || [];
const unsoldPlayers = JSON.parse(localStorage.getItem("players")) || [];

const summary = document.getElementById("summary");
const unsoldDiv = document.getElementById("unsold-players");

// =======================
// TEAMS SUMMARY
// =======================
if (teams.length === 0) {
  summary.innerHTML = "<p>No auction data found.</p>";
} else {
  teams.forEach(team => {
    const teamDiv = document.createElement("div");
    teamDiv.className = "team-summary";

    let playersHTML = "<p>No players bought</p>";

    if (team.playersBought && team.playersBought.length > 0) {
      playersHTML = `
        <ul>
          ${team.playersBought
            .map(p => `<li>${p.name} (${p.type}) — ₹${p.price} Cr</li>`)
            .join("")}
        </ul>
      `;
    }

    teamDiv.innerHTML = `
      <h3>${team.name}</h3>
      <p><strong>Remaining Budget:</strong> ₹${team.budget} Cr</p>
      ${playersHTML}
    `;

    summary.appendChild(teamDiv);
  });
}

// =======================
// UNSOLD PLAYERS
// =======================
if (unsoldPlayers.length === 0) {
  unsoldDiv.innerHTML = "<p>✅ No unsold players. Auction completed.</p>";
} else {
  const ul = document.createElement("ul");
  ul.className = "unsold-list";

  unsoldPlayers.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.name} (${p.type})`;
    ul.appendChild(li);
  });

  unsoldDiv.appendChild(ul);
}
