import express from "express";
import axios from "axios";
import https from "https";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ES Modules workaround für __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment Variablen laden
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;

// API Client konfigurieren
const apiClient = axios.create({
  baseURL: "https://api.challonge.com/v2",
  httpsAgent: new https.Agent({ keepAlive: true }),
  headers: {
    Authorization: process.env.CHALLONGE_API_KEY,
    "Authorization-Type": "v1",
    "Content-Type": "application/vnd.api+json",
    Accept: "application/json",
  },
});

let matchesData = {
  active: [],
  pending: [],
};

function getTableNumber(stationName) {
  const match = stationName?.match(/\d+/);
  return match ? parseInt(match[0]) : Infinity;
}

async function updateMatches() {
  try {
    const matchesRes = await apiClient.get(
      `/tournaments/${process.env.TOURNAMENT_ID}/matches.json`
    );
    const stationsRes = await apiClient.get(
      `/tournaments/${process.env.TOURNAMENT_ID}/stations.json`
    );

    const participants = {};
    matchesRes.data.included?.forEach((item) => {
      if (item.type === "participant") {
        participants[item.id] =
          item.attributes?.name?.replace(" (invitation pending)", "") ||
          `Spieler ${item.id}`;
      }
    });

    const stations = {};
    stationsRes.data.data.forEach((station) => {
      stations[station.id] = station.attributes?.name || `Tisch ${station.id}`;
    });

    // Reset data
    matchesData = { active: [], pending: [] };

    matchesRes.data.data.forEach((match) => {
      const matchData = {
        id: match.id,
        station: stations[match.relationships?.station?.data?.id] || "Tisch ?",
        player1: participants[match.relationships?.player1?.data?.id] || "?",
        player2: participants[match.relationships?.player2?.data?.id] || "?",
        underwayAt: match.attributes?.timestamps?.underwayAt,
        startedAt: match.attributes?.timestamps?.startedAt,
        state: match.attributes?.state,
        suggestedPlayOrder: match.attributes?.suggestedPlayOrder,
      };

      if (match.attributes?.state === "open") {
        matchesData.active.push(matchData); // Alle aktiven Spiele (gestartet oder zugewiesen)
      } else if (match.attributes?.state === "pending") {
        matchesData.pending.push(matchData); // Geplant
      }
    });

    // Sortierung
    matchesData.active.sort(
      (a, b) => getTableNumber(a.station) - getTableNumber(b.station)
    );
    matchesData.pending.sort(
      (a, b) => a.suggestedPlayOrder - b.suggestedPlayOrder
    );
  } catch (error) {
    console.error("Update error:", error.message);
  }
}

const htmlTemplate = (matchesData) => `
<!DOCTYPE html>
<html>
<head>
  <title>${process.env.TOURNAMENT_NAME}</title>
  <meta http-equiv="refresh" content="15">
  <style>
    :root {
      --bg-dark: #121212;
      --card-dark: #1e1e1e;
      --text-dark: #e0e0e0;
      --accent-dark:rgb(205, 197, 253);
      --accent-secondary: #e77b3c;
      --border-dark: #333;
    }

    body.dark-mode {
      background: var(--bg-dark);
      color: var(--text-dark);
    }

    .dark-mode .header {
      background: #0d1b2a;
      color: white;
    }

    .dark-mode .section {
      background: var(--card-dark);
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      border: 1px solid var(--border-dark);
    }

    .dark-mode .section-title {
      color: var(--accent-dark);
      border-bottom: 1px solid var(--border-dark);
    }

    .dark-mode .match-card {
      background: #252525;
      box-shadow: 0 3px 6px rgba(0,0,0,0.3);
      border-left: 6px solid;
    }

    .dark-mode  .started {
      border-color:rgb(25, 105, 58);
    }
    .dark-mode .assigned {
      border-color:rgb(145, 67, 23);
    }

    .dark-mode .status-started {
      background: rgb(25, 105, 58);
    }
    .dark-mode .status-assigned {
      background: rgb(145, 67, 23);
    }

    .dark-mode .station {
      color: var(--accent-dark);
      border-bottom: 1px solid var(--border-dark);
    }

    .dark-mode .players {
      color: var(--text-dark);
    }

    .dark-mode .vs {
      color: #aaa;
    }

    .dark-mode .pending-card {
      background: #252525;
      border-left: 4px solid rgb(46, 143, 204);
    }

    .dark-mode .footer {
      color: #aaa;
    }

    /* Toggle Button */
    .theme-toggle {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--card-dark);
      color: white;
      border: none;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      font-size: 1.5em;
      cursor: pointer;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    body:not(.dark-mode) .theme-toggle {
      background: #2c3e50;
    }
</style>

<script>
    // Dark Mode Toggle
    document.addEventListener('DOMContentLoaded', () => {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'theme-toggle';
      toggleBtn.innerHTML = '🌓';
      toggleBtn.title = 'Dark/Light Mode wechseln';
      document.body.appendChild(toggleBtn);

      toggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
      });

      // Beim Laden prüfen
      if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
      }
    });
</script>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f5f5f5;
      margin: 0;
      padding: 20px;
    }
    .header {
      background: #2c3e50;
      color: white;
      text-align: center;
      padding: 1px;
      margin-bottom: 20px;
      border-radius: 5px;
    }
    .header h1 {
      font-size: 2.5em;
    }
    .section {
      background: white;
      border-radius: 5px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .section-title {
      color: #2c3e50;
      margin-top: 0;
      padding-bottom: 10px;
      border-bottom: 1px solid #eee;
      font-size: 1em;
    }
    .matches-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 15px;
    }
    .match-card {
      background: #fff;
      border-radius: 5px;
      padding: 15px;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.26);
      border-left: 6px solid;
    }
    .started {
      border-color: #2ecc71;
    }
    .assigned {
      border-color:#e77b3c;
    }
    .station {
      font-weight: bold;
      color: #2c3e50;
      margin-bottom: 20px;
      font-size: 1.4em;
      border-bottom: 1px solid #eee;
    }
    .players {
      font-size: 1.8em;
      margin: 5px 0;
    }
    .vs {
      color: #7f8c8d;
      margin: 5px 0;
      font-style: italic;
    }
    .status {
      font-size: 0.7em;
      margin-top: 10px;
      padding: 5px;
      border-radius: 3px;
      color: white;
      display: inline-block;
      float: right;
    }
    .status-started {
      background: #2ecc71;
    }
    .status-assigned {
      background: #e77b3c;
    }
    .timestamp {
     float: right;
      font-size: 0.8em;
      color: #95a5a6;
      margin-top: 5px;
    }
    .pending-matches {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin-top: 15px;
    }
    .pending-card {
      background: #fff;
      border-radius: 5px;
      padding: 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border-left: 4px solid rgb(46, 143, 204);
      font-size: 1.1em;
    }
    .footer {
      text-align: center;
      margin-top: 20px;
      color: #7f8c8d;
      font-size: 0.9em;
    }
    @media (max-width: 900px) {
      .matches-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    @media (max-width: 600px) {
      .matches-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${process.env.TOURNAMENT_NAME}</h1>
  </div>

  <div class="section">
    <h2 class="section-title">Aktuelle Spiele</h2>
    <div class="matches-grid">
      ${matchesData.active
        .map(
          (match) => `
        <div class="match-card ${match.underwayAt ? "started" : "assigned"}">
            <div class="station">${match.station}
                      <div class="status ${
                        match.underwayAt ? "status-started" : "status-assigned"
                      }">
              ${match.underwayAt ? "Spiel läuft" : "warten auf Spieler"}
            </div>
          </div>
          <div class="players">${match.player1}</div>
          <div class="vs">vs</div>
          <div class="players">${match.player2}</div>

          <div class="timestamp">seit ${
            match.underwayAt
              ? new Date(match.underwayAt).toLocaleTimeString()
              : new Date(match.startedAt).toLocaleTimeString()
          }</div>
        </div>
      `
        )
        .join("")}
    </div>
  </div>

  ${
    matchesData.pending.length > 0
      ? `
    <div class="section">
      <h2 class="section-title">Geplante Spiele (${
        matchesData.pending.length
      })</h2>
      <div class="pending-matches">
        ${matchesData.pending
          .map(
            (match) => `
          <div class="pending-card">
            <div>${match.player1} <div class="vs">vs</div> ${match.player2}</div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `
      : ""
  }

  <div class="footer">
    Letzte Aktualisierung: ${new Date().toLocaleTimeString()}
  </div>
</body>
</html>
`;

app.get("/", (req, res) => {
  res.send(htmlTemplate(matchesData));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Tournament: ${process.env.TOURNAMENT_NAME}`);
  updateMatches();
  setInterval(updateMatches, process.env.UPDATE_INTERVAL);
});
