const teamNameInput = document.getElementById("teamNameInput");
const teamBudgetInput = document.getElementById("teambudgetinput");
const playerNameInput = document.getElementById("player-name");

const addTeamBtn = document.getElementById("addteambdgt");
const addPlayerBtn = document.getElementById("add-player"); 
const player_type=document.getElementById("playerCategory");// ✅ FIXED
const playerimg=document.getElementById("playerImage");


const auctionBtn = document.getElementById("live-auction");

let teams = JSON.parse(localStorage.getItem("teams")) || [];
let players = JSON.parse(localStorage.getItem("players")) || [];

// ADD TEAM
addTeamBtn.addEventListener("click", () => {
  const teamName = teamNameInput.value.trim();
  const budget = Number(teamBudgetInput.value);

  if (teamName === "") {
    alert("Team name cannot be empty");
    return;
  }

  if (!budget || budget <= 0) {
    alert("Enter a valid team budget");
    return;
  }
  if (teams.some(t => t.name === teamName)) {
  alert("Team already exists");
  return;
}else{
  const team = {
    name: teamName,
    budget: budget
  };

  teams.push(team);

  
  localStorage.setItem("teams", JSON.stringify(teams));

  

  console.log("Teams:", teams);

  teamNameInput.value = "";
  teamBudgetInput.value = "";
}
});

// ADD PLAYER
addPlayerBtn.addEventListener("click", () => {
  const player = playerNameInput.value.trim();
  const category = player_type.value;

  if (player === "" || category === "") {
    alert("Player name and category cannot be empty");
    return;
  }

  // prevent duplicate players
  if (players.some(p => p.name === player)) {
    alert("Player already exists");
    return;
  }

  const file = playerimg.files[0];
  if (!file) {
    alert("Please select a player image");
    return;
  }

  // Check if file is an image
  if (!file.type.startsWith("image/")) {
    alert("Please select a valid image file");
    return;
  }

  const reader = new FileReader();

  reader.onload = function () {
    const playerInfo = {
      name: player,
      type: category,
      image: reader.result   // ✅ This will be a Base64 string like "data:image/png;base64,..."
    };

    players.push(playerInfo);
    localStorage.setItem("players", JSON.stringify(players));

    console.log("Players:", players);
    console.log("Image stored as:", playerInfo.image);  // Debug: Should show Base64

    // clear inputs
    playerNameInput.value = "";
    player_type.value = "";
    playerimg.value = "";
  };

  reader.onerror = function () {
    alert("Error reading the file. Please try again.");
  };

  reader.readAsDataURL(file); // ✅ Converts file to Base64
});



// START LIVE AUCTION
auctionBtn.addEventListener("click", () => {
  window.location.href = "live.html";
});
