// Actualiza stats.json con el conteo de suscriptores de YouTube via la Data API v3.
// Instagram no tiene una API publica equivalente sin configurar una app de Meta
// con una cuenta Business y token de larga duracion, asi que ese numero por ahora
// se sigue actualizando a mano.

import { readFile, writeFile } from "node:fs/promises";

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = "UCP3niiaRzE22Ao80dEagvYw";
const STATS_PATH = new URL("../stats.json", import.meta.url);

async function main() {
  if (!API_KEY) throw new Error("Falta la variable de entorno YOUTUBE_API_KEY");

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", CHANNEL_ID);
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API channels respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const item = (data.items || [])[0];
  if (!item) throw new Error("El canal no devolvió estadísticas");
  if (item.statistics.hiddenSubscriberCount) {
    console.log("El canal tiene el conteo de suscriptores oculto. Nada para actualizar.");
    return;
  }

  const subscribers = parseInt(item.statistics.subscriberCount, 10);
  const stats = JSON.parse(await readFile(STATS_PATH, "utf8"));

  if (stats.youtube_subscribers === subscribers) {
    console.log(`Suscriptores YT sin cambios (${subscribers}).`);
    return;
  }

  console.log(`Suscriptores YT: ${stats.youtube_subscribers} -> ${subscribers}`);
  stats.youtube_subscribers = subscribers;
  await writeFile(STATS_PATH, JSON.stringify(stats, null, 2) + "\n", "utf8");
}

main().catch((err) => {
  console.error("Fallo el update de stats:", err);
  process.exit(1);
});
