import fs from 'fs';

let content = fs.readFileSync('index.js', 'utf8');

// Add getActiveTournamentId helper
content = content.replace(
  'let inMemoryStore = null;',
  'let inMemoryStore = null;\n\nasync function getActiveTournamentId() {\n  const store = await readParticipantsStore();\n  return store.activeTournamentId || process.env.TOURNAMENT_ID;\n}'
);

// Update createEmptyParticipantsStore
content = content.replace(
  'function createEmptyParticipantsStore() {\n  return { tournaments: {} };\n}',
  'function createEmptyParticipantsStore() {\n  return { activeTournamentId: null, tournaments: {} };\n}'
);

// Update readParticipantsStore line 152
content = content.replace(
  'inMemoryStore = { tournaments: normalizedTournaments };',
  'inMemoryStore = { activeTournamentId: parsed.activeTournamentId || null, tournaments: normalizedTournaments };'
);

// Update readParticipantsStore line 156
content = content.replace(
  'inMemoryStore = {\n        tournaments: {',
  'inMemoryStore = {\n        activeTournamentId: parsed.tournamentId || null,\n        tournaments: {'
);

// Replace process.env.TOURNAMENT_ID in index.js functions
content = content.replace(
  /const tId = tournamentId \|\| process\.env\.TOURNAMENT_ID;/g,
  'const tId = tournamentId || await getActiveTournamentId();'
);
content = content.replace(
  /const configuredTournamentId = process\.env\.TOURNAMENT_ID;/g,
  'const configuredTournamentId = await getActiveTournamentId();'
);

// Fix synchronous clearParticipantsCache (since it doesn't await)
content = content.replace(
  'function clearParticipantsCache(tournamentId) {\n  const tId = tournamentId || process.env.TOURNAMENT_ID;',
  'function clearParticipantsCache(tournamentId) {\n  const tId = tournamentId;'
);

// Allow app.get("/admin") to load even if TOURNAMENT_ID is empty
content = content.replace(
  '  if (!configuredTournamentId) {\n    return res.status(500).send("TOURNAMENT_ID ist nicht in der .env gesetzt.");\n  }',
  ''
);

// Also remove it from app.get("/") but show a setup message
content = content.replace(
  'app.get("/", async (req, res) => {\n  const configuredTournamentId = await getActiveTournamentId();\n  if (!configuredTournamentId) {\n    return res.status(500).send("TOURNAMENT_ID ist nicht in der .env gesetzt.");\n  }',
  'app.get("/", async (req, res) => {\n  const configuredTournamentId = await getActiveTournamentId();\n  if (!configuredTournamentId) {\n    return res.status(200).send("Bitte im Admin-Panel (/admin) eine Turnier-ID eintragen.");\n  }'
);

// Replace the response in admin route so it passes activeTournamentId
content = content.replace(
  'const { state, participantDetails } = await getParticipantsFromStore(configuredTournamentId);',
  'const state = configuredTournamentId ? (await getParticipantsFromStore(configuredTournamentId)).state : { displayMode: "matches" };\n  const participantDetails = configuredTournamentId ? (await getParticipantsFromStore(configuredTournamentId)).participantDetails : [];'
);

content = content.replace(
  'displayMode: state?.displayMode || "matches",',
  'displayMode: state?.displayMode || "matches",\n    activeTournamentId: configuredTournamentId || "",'
);

// Add the new route /admin/save-tournament-id
const newRoute = `
app.post("/admin/save-tournament-id", requireAdminAuth, async (req, res) => {
  const store = await readParticipantsStore();
  store.activeTournamentId = req.body.tournamentId || null;
  await writeParticipantsStore(store);
  return res.redirect("/admin");
});
`;
content = content.replace(
  'app.post("/admin/save-participants", requireAdminAuth, async (req, res) => {',
  newRoute + '\napp.post("/admin/save-participants", requireAdminAuth, async (req, res) => {'
);

fs.writeFileSync('index.js', content, 'utf8');
console.log('index.js updated');
