// Sincroniza merch.json con los productos VISIBLES (published) de Tienda Nube,
// tengan o no stock. Corre en GitHub Actions (secret TIENDANUBE_TOKEN).
// Si la API falla, no toca merch.json y el job termina en error (GitHub manda mail).

import { readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.TIENDANUBE_TOKEN;
const STORE_ID = "8306408";
const USER_AGENT = "Sotano22Sync (mt.sotano22@gmail.com)";
const MERCH_PATH = new URL("../merch.json", import.meta.url);

async function fetchPublishedProducts() {
  const products = [];
  for (let page = 1; ; page++) {
    const url = new URL(`https://api.tiendanube.com/v1/${STORE_ID}/products`);
    url.searchParams.set("published", "true");
    url.searchParams.set("per_page", "200");
    url.searchParams.set("page", String(page));
    url.searchParams.set("fields", "id,name,published,canonical_url,images");

    const res = await fetch(url, {
      headers: { Authentication: `bearer ${TOKEN}`, "User-Agent": USER_AGENT },
    });
    // Tienda Nube responde 404 cuando se pide una página más allá de la última
    if (res.status === 404 && page > 1) break;
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tienda Nube respondió ${res.status}: ${body.slice(0, 300)}`);
    }
    const batch = await res.json();
    products.push(...batch);
    if (batch.length < 200) break;
  }
  return products.filter((p) => p.published);
}

// "Piluso Sótano 22" -> "Piluso", "Buzo Sótano 22 — Opción 1" -> "Buzo — Opción 1"
function displayName(name) {
  const raw = (name && (name.es || Object.values(name)[0])) || "";
  return raw.replace(/\s*S[óo]tano\s*22\b/i, "").replace(/\s{2,}/g, " ").trim() || raw;
}

async function main() {
  if (!TOKEN) throw new Error("Falta la variable de entorno TIENDANUBE_TOKEN");

  const products = await fetchPublishedProducts();
  const items = products
    .filter((p) => p.images && p.images.length)
    .map((p) => ({
      name: displayName(p.name),
      image: p.images[0].src,
      url: p.canonical_url,
    }));

  const skipped = products.length - items.length;
  if (skipped) console.log(`${skipped} producto(s) visible(s) sin foto: no se muestran en la web.`);

  const current = await readFile(MERCH_PATH, "utf8");
  const next = JSON.stringify(items, null, 2) + "\n";
  if (current === next) {
    console.log(`Merch sin cambios (${items.length} productos visibles).`);
    return;
  }
  console.log(`Merch actualizado: ${items.length} productos visibles -> ${items.map((i) => i.name).join(", ") || "(ninguno)"}`);
  await writeFile(MERCH_PATH, next, "utf8");
}

main().catch((err) => {
  console.error("Falló la sincronización del merch:", err.message);
  process.exit(1);
});
