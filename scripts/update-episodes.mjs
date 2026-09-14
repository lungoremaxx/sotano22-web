// Chequea el canal de YouTube en busca de nuevas Sotaneadas y actualiza episodes.json.
// No requiere API key: usa el feed RSS público del canal + scraping liviano de la
// duración desde la página del video.

import { readFile, writeFile } from "node:fs/promises";

const CHANNEL_ID = "UCP3niiaRzE22Ao80dEagvYw";
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

async function fetchFeedEntries() {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  if (!res.ok) throw new Error(`Feed RSS respondió ${res.status}`);
  const xml = await res.text();
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const block = m[1];
    const videoId = (block.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
    const link = (block.match(/<link rel="alternate" href="(.*?)"/) || [])[1] || "";
    if (videoId && title) entries.push({ videoId, title: decodeXml(title), isShort: link.includes("/shorts/") });
  }
  return entries;
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchDuration(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Watch page respondió ${res.status}`);
  const html = await res.text();
  const m = html.match(/"lengthSeconds":"(\d+)"/);
  if (!m) throw new Error("No se encontró lengthSeconds");
  return formatDuration(parseInt(m[1], 10));
}

async function main() {
  const current = JSON.parse(await readFile(EPISODES_PATH, "utf8"));
  const knownIds = new Set(current.map((e) => e.videoId));
  const maxNum = current.reduce((max, e) => Math.max(max, e.num), 0);

  const feedEntries = await fetchFeedEntries();
  const candidates = [];

  for (const entry of feedEntries) {
    if (entry.isShort) continue;
    if (knownIds.has(entry.videoId)) continue;
    const match = entry.title.match(TITLE_RE);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (num <= maxNum) continue; // ya lo tenemos o es un numero viejo/reeditado
    candidates.push({ num, videoId: entry.videoId, title: cleanGuestName(match[2]) });
  }

  if (candidates.length === 0) {
    console.log("Sin Sotaneadas nuevas. Nada para actualizar.");
    return;
  }

  candidates.sort((a, b) => a.num - b.num);

  for (const cand of candidates) {
    try {
      cand.duration = await fetchDuration(cand.videoId);
    } catch (err) {
      console.warn(`No se pudo obtener la duración de #${cand.num} (${cand.videoId}): ${err.message}`);
      cand.duration = "";
    }
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
