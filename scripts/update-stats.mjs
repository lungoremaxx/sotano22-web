// Actualiza stats.json con:
// - suscriptores de YouTube, via la Data API v3 (secret YOUTUBE_API_KEY)
// - seguidores de Instagram, via la Graph API de Meta (secret META_PAGE_TOKEN).
//   Se leen a traves de la pagina de Facebook "Sotano 22", que tiene vinculada
//   la cuenta @sotano.22. El token es un token de pagina que no vence.
// Si falla YouTube, el job termina en error (GitHub manda mail).
// Si falla Instagram solo se loguea, salvo que el número lleve más de
// IG_STALE_DAYS sin actualizarse: ahí el job falla una vez por semana (lunes)
// para avisar sin mandar un mail en cada corrida.

import { readFile, writeFile } from "node:fs/promises";

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const META_PAGE_TOKEN = process.env.META_PAGE_TOKEN;
const CHANNEL_ID = "UCP3niiaRzE22Ao80dEagvYw";
const FB_PAGE_ID = "1126812440523412";
const GRAPH_VERSION = "v26.0";
const IG_STALE_DAYS = 7;
const STATS_PATH = new URL("../stats.json", import.meta.url);

async function fetchYoutubeSubscribers() {
  if (!YT_API_KEY) throw new Error("Falta la variable de entorno YOUTUBE_API_KEY");

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", CHANNEL_ID);
  url.searchParams.set("key", YT_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API channels respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const item = (data.items || [])[0];
  if (!item) throw new Error("El canal no devolvió estadísticas");
  if (item.statistics.hiddenSubscriberCount) {
    console.log("El canal tiene el conteo de suscriptores oculto.");
    return null;
  }
  return parseInt(item.statistics.subscriberCount, 10);
}

async function fetchInstagramFollowers() {
  if (!META_PAGE_TOKEN) {
    console.log("Sin META_PAGE_TOKEN: se saltea Instagram.");
    return null;
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${FB_PAGE_ID}`);
  url.searchParams.set("fields", "instagram_business_account{username,followers_count}");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${META_PAGE_TOKEN}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const ig = data.instagram_business_account;
  if (!ig || typeof ig.followers_count !== "number") {
    throw new Error("La página no devolvió una cuenta de Instagram vinculada con followers_count");
  }
  return ig.followers_count;
}

async function main() {
  const stats = JSON.parse(await readFile(STATS_PATH, "utf8"));
  const sources = [
    ["youtube_subscribers", "Suscriptores YT", fetchYoutubeSubscribers],
    ["instagram_followers", "Seguidores IG", fetchInstagramFollowers],
  ];

  let changed = false;
  let failed = false;
  for (const [key, label, fetcher] of sources) {
    try {
      const value = await fetcher();
      if (value == null) continue;
      if (key === "instagram_followers") {
        const today = new Date().toISOString().slice(0, 10);
        if (stats.instagram_updated_at !== today) {
          stats.instagram_updated_at = today;
          changed = true;
        }
      }
      if (stats[key] === value) {
        console.log(`${label} sin cambios (${value}).`);
        continue;
      }
      console.log(`${label}: ${stats[key]} -> ${value}`);
      stats[key] = value;
      changed = true;
    } catch (err) {
      console.error(`Falló ${label}:`, err.message);
      if (key !== "instagram_followers") failed = true;
    }
  }

  if (instagramStaleAlert(stats.instagram_updated_at)) failed = true;
  if (changed) await writeFile(STATS_PATH, JSON.stringify(stats, null, 2) + "\n", "utf8");
  if (META_PAGE_TOKEN && !(await metaTokenHealthy())) failed = true;
  if (failed) process.exit(1);
}

function instagramStaleAlert(updatedAt) {
  if (!updatedAt) return false;
  const days = Math.floor((Date.now() - Date.parse(updatedAt)) / 86_400_000);
  if (days <= IG_STALE_DAYS) return false;
  const msg = `ATENCIÓN: seguidores de Instagram sin actualizar hace ${days} días (último OK: ${updatedAt}).`;
  const now = new Date();
  const weeklyRun = process.env.GITHUB_EVENT_NAME !== "schedule" || (now.getUTCDay() === 1 && now.getUTCHours() < 12);
  if (!weeklyRun) {
    console.log(msg);
    return false;
  }
  console.error(msg);
  return true;
}

// El token de pagina no vence, pero Meta corta el acceso a datos a los 90 dias
// (data_access_expires_at). Avisamos con tiempo haciendo fallar el job, asi
// GitHub manda mail. Se renueva con el script "Renovar token Instagram" (fuera del repo).
const EXPIRY_WARNING_DAYS = 21;

async function metaTokenHealthy() {
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token`);
    url.searchParams.set("input_token", META_PAGE_TOKEN);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${META_PAGE_TOKEN}` } });
    const { data } = await res.json();
    const expiresAt = data?.data_access_expires_at;
    if (!expiresAt) return true;
    const daysLeft = Math.floor((expiresAt * 1000 - Date.now()) / 86_400_000);
    if (daysLeft > EXPIRY_WARNING_DAYS) {
      console.log(`Token de Meta: acceso a datos por ${daysLeft} días más.`);
      return true;
    }
    console.error(
      `ATENCIÓN: el acceso a datos del token de Meta vence en ${daysLeft} días ` +
        `(${new Date(expiresAt * 1000).toLocaleDateString("es-AR")}). Renovar META_PAGE_TOKEN.`
    );
    return false;
  } catch (err) {
    console.error("No se pudo verificar el vencimiento del token de Meta:", err.message);
    return true;
  }
}

main().catch((err) => {
  console.error("Falló el update de stats:", err);
  process.exit(1);
});
