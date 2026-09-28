// Chequea el canal de YouTube en busca de nuevas Sotaneadas y actualiza episodes.json.
// Usa la YouTube Data API v3 (requiere YOUTUBE_API_KEY como secret) en vez de
// scrapear el sitio, porque YouTube bloquea con 404 los pedidos al feed RSS
// que vienen desde las IPs de los runners de GitHub Actions.

import { readFile, writeFile } from "node:fs/promises";

const API_KEY = process.env.YOUTUBE_API_KEY;
// El playlist de "subidos" de un canal es siempre el channel id con UC -> UU.
const UPLOADS_PLAYLIST_ID = "UUP3niiaRzE22Ao80dEagvYw";
const EPISODES_PATH = new URL("../episodes.json", import.meta.url);
const TITLE_RE = /sotaneada\s*#?\s*(\d+)\s*:\s*(.+)/i;

function cleanGuestName(raw) {
  return raw.replace(/\s+en\s+s[oó]tano\s*22\s*$/i, "").trim();
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// "PT1H2M34S" -> segundos
function parseIsoDuration(iso) {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + min * 60 + s;
}

async function apiGet(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", API_KEY);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${path} respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchRecentUploads() {
  const data = await apiGet("playlistItems", {
    part: "snippet",
    playlistId: UPLOADS_PLAYLIST_ID,
    maxResults: "15",
  });
  return (data.items || []).map((item) => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
  }));
}

async function fetchDurations(videoIds) {
  if (videoIds.length === 0) return {};
  const data = await apiGet("videos", {
    part: "contentDetails",
    id: videoIds.join(","),
  });
  const durations = {};
  for (const item of data.items || []) {
    durations[item.id] = formatDuration(parseIsoDuration(item.contentDetails.duration));
  }
  return durations;
}

async function main() {
  if (!API_KEY) throw new Error("Falta la variable de entorno YOUTUBE_API_KEY");

  const current = JSON.parse(await readFile(EPISODES_PATH, "utf8"));
  const knownIds = new Set(current.map((e) => e.videoId));
  const maxNum = current.reduce((max, e) => Math.max(max, e.num), 0);

  const uploads = await fetchRecentUploads();
  const candidates = [];

  for (const entry of uploads) {
    if (knownIds.has(entry.videoId)) continue;
    const match = entry.title.match(TITLE_RE);
    if (!match) continue; // no matchea "Sotaneada #N: ..." -> short, promo, etc.
    const num = parseInt(match[1], 10);
    if (num <= maxNum) continue; // ya lo tenemos o es un numero viejo/reeditado
    candidates.push({ num, videoId: entry.videoId, title: cleanGuestName(match[2]) });
  }

  if (candidates.length === 0) {
    console.log("Sin Sotaneadas nuevas. Nada para actualizar.");
    return;
  }

  candidates.sort((a, b) => a.num - b.num);

  const durations = await fetchDurations(candidates.map((c) => c.videoId));
  for (const cand of candidates) {
    cand.duration = durations[cand.videoId] || "";
    console.log(`Nueva Sotaneada detectada: #${cand.num} — ${cand.title} (${cand.videoId})`);
  }

  const updated = [...candidates.reverse(), ...current];
  await writeFile(EPISODES_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");
  console.log(`episodes.json actualizado con ${candidates.length} episodio(s) nuevo(s).`);
}

main().catch((err) => {
  console.error("Fallo el update de episodios:", err);
  process.exit(1);
});
