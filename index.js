import express from "express";
import axios from "axios";
import https from "https";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import util from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => {
  if (process.env.LOG_ENABLED === "true") {
    console.log(`[WEBAPP] ${req.method} ${req.url}`);
  }
  next();
});
const PORT = process.env.PORT || 3000;
const LOG_ENABLED = process.env.LOG_ENABLED === "true";
const CHALLONGE_API_BASE_URL =
  process.env.CHALLONGE_API_BASE_URL || "https://api.challonge.com/v2.1";
const MAX_LOG_CHARS = Number(process.env.API_LOG_MAX_CHARS) || 8000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pw123";
const PARTICIPANTS_STATE_FILE = path.join(
  __dirname,
  "data",
  "participants-state.json"
);

function formatLogValue(value) {
  if (value === undefined) return "<empty>";
  let output;
  try {
    output = typeof value === "string" ? value : JSON.stringify(value, null, 2) || String(value);
  } catch {
    output = util.inspect(value, { depth: 5, maxArrayLength: 50 });
  }
  if (output.length > MAX_LOG_CHARS) {
    return `${output.slice(0, MAX_LOG_CHARS)}\n... <truncated>`;
  }
  return output;
}

let overrideApiKey = null;

const apiClient = axios.create({
  baseURL: CHALLONGE_API_BASE_URL,
  httpsAgent: new https.Agent({ keepAlive: true }),
  headers: {
    Authorization: process.env.CHALLONGE_API_KEY,
    "Authorization-Type": "v1",
    "Content-Type": "application/vnd.api+json",
    Accept: "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  if (overrideApiKey) {
    config.headers.Authorization = overrideApiKey;
  }
  if (LOG_ENABLED) {
    config.metadata = { startTime: Date.now() };
    const method = (config.method || "get").toUpperCase();
    const url = `${config.baseURL || ""}${config.url || ""}`;
    console.log(`[API REQUEST] ${method} ${url}`);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    if (LOG_ENABLED) {
      const startTime = response.config.metadata?.startTime;
      const duration = startTime ? Date.now() - startTime : "?";
      const method = (response.config.method || "get").toUpperCase();
      const url = `${response.config.baseURL || ""}${response.config.url || ""}`;
      console.log(`[API RESPONSE] ${method} ${url} -> ${response.status} (${duration}ms)`);
    }
    return response;
  },
  (error) => {
    if (LOG_ENABLED) {
      const config = error.config || {};
      const startTime = config.metadata?.startTime;
      const duration = startTime ? Date.now() - startTime : "?";
      const method = (config.method || "get").toUpperCase();
      const url = `${config.baseURL || ""}${config.url || ""}`;
      const status = error.response?.status || "ERR";
      console.error(`[API ERROR] ${method} ${url} -> ${status} (${duration}ms)`);
    }
    return Promise.reject(error);
  }
);

let matchesCache = {};
let cacheTimestamps = {};
let participantsCache = {};
let participantsDetailsCache = {};
let participantsCacheLoaded = {};
const CACHE_INTERVAL = Number(process.env.API_CACHE_INTERVAL) || 60000;
const WEB_REFRESH_INTERVAL = Number(process.env.WEB_REFRESH_INTERVAL) || 15;

function log(...args) {
  if (LOG_ENABLED) console.log(...args);
}

function getTableNumber(stationName) {
  const match = stationName?.match(/\d+/);
  return match ? parseInt(match[0]) : Infinity;
}

function getTimestampValue(timestamps, camelKey, snakeKey) {
  return timestamps?.[snakeKey] || timestamps?.[camelKey] || null;
}

function createEmptyParticipantState(tournamentId) {
  return {
    tournamentId,
    updatedAt: null,
    displayMode: "matches",
    participants: {},
  };
}

function createEmptyParticipantsStore() {
  return { activeTournamentId: null, tournaments: {} };
}

const CONFIG_FILE = path.join(__dirname, "data", "config.json");

let inMemoryConfig = null;

async function readConfig() {
  if (inMemoryConfig) return inMemoryConfig;
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    inMemoryConfig = JSON.parse(raw);
  } catch {
    inMemoryConfig = { activeTournamentId: null, displayMode: "matches" };
  }
  return inMemoryConfig;
}

async function writeConfig(config) {
  inMemoryConfig = config;
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

let inMemoryStore = null;

async function getActiveTournamentId() {
  const config = await readConfig();
  if (config.activeTournamentId) return config.activeTournamentId;
  const store = await readParticipantsStore();
  if (store.activeTournamentId) {
    config.activeTournamentId = store.activeTournamentId;
    await writeConfig(config);
    return config.activeTournamentId;
  }
  return process.env.TOURNAMENT_ID || null;
}

async function readParticipantsStore() {
  if (inMemoryStore) return inMemoryStore;
  try {
    const raw = await fs.readFile(PARTICIPANTS_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.tournaments) {
      const normalizedTournaments = {};
      for (const [tournamentId, tournamentState] of Object.entries(parsed.tournaments || {})) {
        normalizedTournaments[tournamentId] = {
          tournamentId,
          updatedAt: tournamentState?.updatedAt || null,
          displayMode: tournamentState?.displayMode || "matches",
          participants: tournamentState?.participants || {},
        };
      }
      inMemoryStore = { activeTournamentId: parsed.activeTournamentId || null, tournaments: normalizedTournaments };
      return inMemoryStore;
    }
    if (parsed?.tournamentId && parsed?.participants) {
      inMemoryStore = {
        activeTournamentId: parsed.tournamentId || null,
        tournaments: {
          [parsed.tournamentId]: {
            tournamentId: parsed.tournamentId,
            updatedAt: parsed.updatedAt || null,
            displayMode: parsed.displayMode || "matches",
            participants: parsed.participants || {},
          },
        },
      };
      return inMemoryStore;
    }
    inMemoryStore = createEmptyParticipantsStore();
    return inMemoryStore;
  } catch {
    inMemoryStore = createEmptyParticipantsStore();
    return inMemoryStore;
  }
}

async function writeParticipantsStore(store) {
  inMemoryStore = store;
  await fs.mkdir(path.dirname(PARTICIPANTS_STATE_FILE), { recursive: true });
  await fs.writeFile(PARTICIPANTS_STATE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function getParticipantsFromStore(tournamentId) {
  const store = await readParticipantsStore();
  const state = store.tournaments?.[tournamentId] || createEmptyParticipantState(tournamentId);

  const participantDetails = Object.values(state.participants || {}).map((participant) => ({
    id: participant.participantId,
    teamName: participant.teamName || `Spieler ${participant.participantId}`,
    username: participant.username || "",
    seed: participant.seed ?? null,
    active: participant.active ?? false,
    checkin: participant.checkin ?? false,
    paid: participant.paid ?? false,
    note: participant.note || "",
  }));

  const participantsMap = participantDetails.reduce((accumulator, participant) => {
    accumulator[participant.id] = participant.teamName;
    return accumulator;
  }, {});

  return { state, participantDetails, participantsMap };
}

async function loadParticipants(tournamentId, forceReload = false) {
  const tId = tournamentId || await getActiveTournamentId();
  if (participantsCacheLoaded[tId] && !forceReload) {
    return participantsCache[tId] || {};
  }

  const participantsRes = await apiClient.get(`/tournaments/${tId}/participants.json`);
  const participants = {};
  const participantDetails = [];
  const store = await readParticipantsStore();
  const storedState = store.tournaments?.[tId] || createEmptyParticipantState(tId);

  participantsRes.data.data?.forEach((participant) => {
    const displayName = participant.attributes?.name?.replace(" (invitation pending)", "") || `Spieler ${participant.id}`;
    const storedParticipant = storedState.participants?.[participant.id] || {};
    const teamName = storedParticipant.teamName || displayName;
    const checkin = storedParticipant.checkin ?? false;
    const paid = storedParticipant.paid ?? false;
    const note = storedParticipant.note || "";

    participants[participant.id] = teamName;
    participantDetails.push({
      id: participant.id,
      teamName,
      username: participant.attributes?.username || "",
      seed: participant.attributes?.seed ?? null,
      active: participant.attributes?.states?.active ?? false,
      checkin,
      paid,
      note,
    });
  });

  participantsCache[tId] = participants;
  participantsDetailsCache[tId] = participantDetails;
  participantsCacheLoaded[tId] = true;

  const nextState = {
    tournamentId: tId,
    updatedAt: new Date().toISOString(),
    displayMode: storedState.displayMode || "matches",
    participants: participantDetails.reduce((accumulator, participant) => {
      accumulator[participant.id] = {
        participantId: participant.id,
        teamName: participant.teamName,
        username: participant.username,
        seed: participant.seed,
        active: participant.active,
        checkin: participant.checkin,
        paid: participant.paid,
        note: participant.note,
      };
      return accumulator;
    }, {}),
  };

  store.tournaments[tId] = nextState;
  await writeParticipantsStore(store);
  return participants;
}

function clearParticipantsCache(tournamentId) {
  const tId = tournamentId;
  delete participantsCache[tId];
  delete participantsDetailsCache[tId];
  delete participantsCacheLoaded[tId];
}

async function refetchParticipants(tournamentId) {
  const tId = tournamentId || await getActiveTournamentId();
  clearParticipantsCache(tId);
  return loadParticipants(tId, true);
}

function isAdminAuthenticated(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Basic ")) return false;
  const encodedCredentials = authHeader.slice(6);
  const decodedCredentials = Buffer.from(encodedCredentials, "base64").toString("utf8").split(":");
  const [username, password] = decodedCredentials;
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

function requireAdminAuth(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  res.setHeader("WWW-Authenticate", 'Basic realm="Admin"');
  return res.status(401).send("Authentication required.");
}

async function getTournamentState(tournamentId) {
  const store = await readParticipantsStore();
  return store.tournaments?.[tournamentId] || createEmptyParticipantState(tournamentId);
}

function buildMatchData(match, stations, participants, fallbackRelationships = {}) {
  const relationships = match.relationships || {};
  const timestamps = match.attributes?.timestamps || {};
  const participantEntries = match.attributes?.points_by_participant || [];
  
  const p1Rel = relationships.player1?.data?.id || fallbackRelationships.player1?.data?.id;
  const p2Rel = relationships.player2?.data?.id || fallbackRelationships.player2?.data?.id;
  
  const player1Id = p1Rel || participantEntries[0]?.participant_id;
  const player2Id = p2Rel || participantEntries[1]?.participant_id;
  const stationId = relationships.station?.data?.id || fallbackRelationships.station?.data?.id;

  return {
    id: match.id,
    station: stations[stationId]?.name || "Tisch ?",
    player1: participants[player1Id] || `Spieler ${player1Id || "?"}`,
    player2: participants[player2Id] || `Spieler ${player2Id || "?"}`,
    underwayAt: getTimestampValue(timestamps, "underwayAt", "underway_at"),
    startedAt: getTimestampValue(timestamps, "startedAt", "started_at"),
    state: match.attributes?.state,
    suggestedPlayOrder:
      match.attributes?.suggestedPlayOrder ??
      match.attributes?.suggested_play_order ??
      Number.MAX_SAFE_INTEGER,
  };
}

async function updateMatches(tournamentId) {
  const tId = tournamentId || await getActiveTournamentId();
  try {
    log(`[API CALL] Fetching data for tournament ID: ${tId}`);
    const matchesRes = await apiClient.get(`/tournaments/${tId}/matches.json`);
    const stationsRes = await apiClient.get(`/tournaments/${tId}/stations.json`);

    // We must load participants if they are not cached.
    let { participantsMap } = await getParticipantsFromStore(tId);
    if (Object.keys(participantsMap).length === 0) {
      await loadParticipants(tId);
      const refresh = await getParticipantsFromStore(tId);
      participantsMap = refresh.participantsMap;
    }

    const stations = {};
    const stationByMatchId = {};
    stationsRes.data.data.forEach((station) => {
      stations[station.id] = {
        name: station.attributes?.name || `Tisch ${station.id}`,
        matchId: station.attributes?.match_id || null,
      };
      if (station.attributes?.match_id) {
        stationByMatchId[station.attributes.match_id] = station.id;
      }
    });

    const newData = { active: [], pending: [] };
    const allMatches = [...(matchesRes.data?.data || [])];

    if (stationsRes.data?.included) {
      stationsRes.data.included.forEach(inc => {
        if (inc.type === "match" && !allMatches.some(m => m.id === inc.id)) {
          allMatches.push(inc);
        }
      });
    }

    allMatches.forEach((match) => {
      const stationId = stationByMatchId[match.id];
      if (stationId) {
        const fallbackRelationships = {
          station: { data: { id: stationId, type: "station" } },
        };
        newData.active.push(buildMatchData(match, stations, participantsMap, fallbackRelationships));
      } else if (match.attributes?.state === "pending") {
        newData.pending.push(buildMatchData(match, stations, participantsMap, match.relationships));
      }
    });

    newData.active.sort((a, b) => getTableNumber(a.station) - getTableNumber(b.station));
    newData.pending.sort((a, b) => a.suggestedPlayOrder - b.suggestedPlayOrder);

    matchesCache[tId] = newData;
    cacheTimestamps[tId] = Date.now();
  } catch (error) {
    console.error("Update error:", error.message);
  }
}

async function getMatchesData(tId) {
  const now = Date.now();
  if (!matchesCache[tId] || !cacheTimestamps[tId] || now - cacheTimestamps[tId] > CACHE_INTERVAL) {
    await updateMatches(tId);
    log(`[CACHE MISS] Updated cache for tournament ID: ${tId}`);
  } else {
    log(`[CACHE READ] Served cached data for tournament ID: ${tId}`);
  }
  return matchesCache[tId] || { active: [], pending: [] };
}

app.get("/", async (req, res) => {
  const configuredTournamentId = await getActiveTournamentId();

  const state = await getTournamentState(configuredTournamentId);
  const config = await readConfig();
  if ((config.displayMode || "matches") === "participants") {
    const { participantDetails } = await getParticipantsFromStore(configuredTournamentId);
    return res.render("participants", {
      participants: participantDetails,
      tournamentName: process.env.TOURNAMENT_NAME,
      webRefreshInterval: WEB_REFRESH_INTERVAL
    });
  }
  const data = await getMatchesData(configuredTournamentId);
  log(`[PAGE LOAD] Served data for tournament ID: ${configuredTournamentId}`);
  return res.render("index", {
    matchesData: data,
    tournamentName: process.env.TOURNAMENT_NAME,
    webRefreshInterval: WEB_REFRESH_INTERVAL
  });
});

app.get("/admin", requireAdminAuth, async (req, res) => {
  const configuredTournamentId = await getActiveTournamentId();
  if (!configuredTournamentId) {
    return res.status(500).send("TOURNAMENT_ID ist nicht in der .env gesetzt.");
  }
  const state = configuredTournamentId ? (await getParticipantsFromStore(configuredTournamentId)).state : { displayMode: "matches" };
  const participantDetails = configuredTournamentId ? (await getParticipantsFromStore(configuredTournamentId)).participantDetails : [];
  const config = await readConfig();
  return res.render("admin", {
    participantCount: participantDetails.length,
    refetchedAt: null,
    message: "",
    participants: participantDetails,
    displayMode: config.displayMode || "matches",
    activeTournamentId: configuredTournamentId || "",
    overrideApiKey: overrideApiKey || "",
  });
});


app.post("/admin/save-config", requireAdminAuth, async (req, res) => {
  const config = await readConfig();
  if (req.body.tournamentId !== undefined) {
    config.activeTournamentId = req.body.tournamentId || null;
  }
  if (req.body.displayMode !== undefined) {
    config.displayMode = req.body.displayMode;
  }
  if (req.body.overrideApiKey !== undefined) {
    overrideApiKey = req.body.overrideApiKey.trim() || null;
  }
  await writeConfig(config);
  return res.redirect("/admin");
});

app.post("/admin/save-participants", requireAdminAuth, async (req, res) => {
  const configuredTournamentId = await getActiveTournamentId();
  if (!configuredTournamentId) {
    return res.status(500).send("TOURNAMENT_ID ist nicht in der .env gesetzt.");
  }
  const store = await readParticipantsStore();
  const state = store.tournaments?.[configuredTournamentId] || createEmptyParticipantState(configuredTournamentId);
  const body = req.body || {};

  const { participantDetails } = await getParticipantsFromStore(configuredTournamentId);

  participantDetails.forEach((participant) => {
    const checkinChecked = body[`checkin_${participant.id}`] !== undefined;
    const paidChecked = body[`paid_${participant.id}`] !== undefined;
    const noteValue = body[`note_${participant.id}`] !== undefined ? body[`note_${participant.id}`] : (participant.note || "");

    state.participants[participant.id] = {
      participantId: participant.id,
      teamName: participant.teamName,
      username: participant.username,
      seed: participant.seed,
      active: participant.active,
      checkin: checkinChecked,
      paid: paidChecked,
      note: noteValue,
    };
  });

  state.tournamentId = configuredTournamentId;
  state.updatedAt = new Date().toISOString();
  store.tournaments[configuredTournamentId] = state;
  await writeParticipantsStore(store);
  clearParticipantsCache(configuredTournamentId);

  const refreshed = await getParticipantsFromStore(configuredTournamentId);
  const config = await readConfig();
  return res.render("admin", {
    participantCount: refreshed.participantDetails.length,
    refetchedAt: new Date().toLocaleTimeString(),
    message: "Status gespeichert.",
    participants: refreshed.participantDetails,
    displayMode: config.displayMode || "matches",
    activeTournamentId: configuredTournamentId || "",
  });
});

app.post("/admin/refetch-participants", requireAdminAuth, async (req, res) => {
  const configuredTournamentId = await getActiveTournamentId();
  if (!configuredTournamentId) {
    return res.status(500).json({ error: "TOURNAMENT_ID ist nicht in der .env gesetzt." });
  }
  try {
    const participants = await refetchParticipants(configuredTournamentId);
    return res.json({ success: true, count: Object.keys(participants).length });
  } catch (error) {
    return res.status(500).json({ error: `Refetch fehlgeschlagen: ${error.message}` });
  }
});

async function bootstrap() {
  try {
    const configuredTournamentId = await getActiveTournamentId();
    const state = await getTournamentState(configuredTournamentId);
    console.log(`[INITIAL] Loaded local participant store for tournament ID: ${configuredTournamentId}`);
    if ((state?.displayMode || "matches") === "participants") {
      console.log(`[INITIAL] Participant mode active; using local JSON store for tournament ID: ${configuredTournamentId}`);
    }
  } catch (error) {
    console.error(`[INITIAL] Participant preload failed: ${error.message}`);
  }

  app.listen(PORT, () => {
    console.log(`[INITIAL] Server running on http://localhost:${PORT}`);
    console.log(`[INITIAL] Title: ${process.env.TOURNAMENT_NAME}`);
  });
}

bootstrap();
