/**
 * Check every configured free model id against OpenRouter's live catalog.
 *
 * The free tier rotates models often. A retired id returns 404 at request
 * time, which used to abort the whole chat request. This script fails loudly
 * at build time instead, so a retired id is caught before it reaches users.
 *
 * Usage:
 *   npm run check:models
 *
 * No API key needed — the catalog endpoint is public.
 */

import { OPENROUTER_ALL_MODELS } from "../lib/constants";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

type CatalogEntry = {
  id: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};

type Catalog = {
  data?: CatalogEntry[];
};

async function fetchCatalog(): Promise<CatalogEntry[]> {
  const response = await fetch(CATALOG_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${CATALOG_URL} returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as Catalog;
  return payload.data ?? [];
}

function main(): void {
  console.log("Checking configured free models against the live OpenRouter catalog…\n");

  const configured: string[] = [...OPENROUTER_ALL_MODELS];

  for (const id of configured) {
    if (!id.endsWith(":free")) {
      console.error(`FAIL  ${id} — not a free route. The app must never call a paid model.`);
      process.exitCode = 1;
    }
  }

  fetchCatalog()
    .then((entries) => {
      const free = new Set(
        entries.filter((entry) => entry.id.endsWith(":free")).map((entry) => entry.id),
      );
      const chatCapable = new Set(
        entries
          .filter((entry) => {
            const output = entry.architecture?.output_modalities;
            return !output || output.includes("text");
          })
          .map((entry) => entry.id),
      );

      let failed = false;

      for (const id of configured) {
        if (!free.has(id)) {
          console.error(`FAIL  ${id} — retired or not on the free tier any more.`);
          failed = true;
        } else if (!chatCapable.has(id)) {
          console.error(`FAIL  ${id} — does not output text.`);
          failed = true;
        } else {
          console.log(`  ok  ${id}`);
        }
      }

      const unused = [...free]
        .filter((id) => !configured.includes(id))
        .filter((id) => !id.includes("content-safety") && !id.includes("super-vl"))
        .sort();

      if (unused.length > 0) {
        console.log("\nFree chat models not currently configured (candidates for the next trio):");
        for (const id of unused) console.log(`   +  ${id}`);
      }

      if (failed) {
        console.error(
          "\nSome configured models are gone. Update lib/constants.ts with live ids from the list above.",
        );
        process.exitCode = 1;
      } else {
        console.log(`\nAll ${configured.length} configured models are live on the free tier.`);
      }
    })
    .catch((error: unknown) => {
      console.error(`Could not read the model catalog: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}

main();
