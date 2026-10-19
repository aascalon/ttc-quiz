// Downloads the TTC GTFS feed from Toronto Open Data and writes src/data/routes.json,
// shapes.json (route lines) and lookalikes.json (routes whose lines look the same).
import { mkdir, writeFile, access } from "node:fs/promises";
import AdmZip from "adm-zip";
import { parseCsv, toQuizRoutes } from "./normalize.mjs";
import { buildRouteShapes, encodePolyline, findLookalikes } from "./shapes.mjs";

const GTFS_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/7795b45e-e65a-4465-81fc-c36b9dfff169/resource/cfb6b2b8-6191-41e3-bda1-b175c51148cb/download/opendata_ttc_schedules.zip";
const ZIP_PATH = "data-raw/gtfs.zip";
const OUT_PATH = "src/data/routes.json";
const SHAPES_PATH = "src/data/shapes.json";
const LOOKALIKES_PATH = "src/data/lookalikes.json";

const refresh = process.argv.includes("--refresh");
const cached = await access(ZIP_PATH).then(() => true, () => false);

if (refresh || !cached) {
  console.log(`Downloading ${GTFS_URL}`);
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  await mkdir("data-raw", { recursive: true });
  await writeFile(ZIP_PATH, Buffer.from(await res.arrayBuffer()));
} else {
  console.log(`Using cached ${ZIP_PATH} (pass --refresh to re-download)`);
}

const zip = new AdmZip(ZIP_PATH);
const readCsv = (name) => {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${name} not found in GTFS zip`);
  return parseCsv(entry.getData().toString("utf8"));
};

const routeRows = readCsv("routes.txt");
const allRoutes = toQuizRoutes(routeRows);

const quizNumbers = new Set(allRoutes.map((r) => r.number));
const routeIdToNumber = new Map(
  routeRows.filter((r) => quizNumbers.has(r.route_short_name)).map((r) => [r.route_id, r.route_short_name]),
);
const shapes = buildRouteShapes(readCsv("trips.txt"), readCsv("shapes.txt"), routeIdToNumber);
// Routes with no trips in this feed aren't currently running; leave them out of the quiz.
const unserved = allRoutes.filter((r) => !shapes[r.number]?.length).map((r) => r.number);
const routes = allRoutes.filter((r) => shapes[r.number]?.length);
if (unserved.length) console.log(`Skipping routes with no scheduled trips: ${unserved.join(", ")}`);

await mkdir("src/data", { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(routes, null, 2) + "\n");
const counts = routes.reduce((acc, r) => ((acc[r.mode] = (acc[r.mode] ?? 0) + 1), acc), {});
console.log(`Wrote ${routes.length} routes to ${OUT_PATH}`, counts);

const json = JSON.stringify(Object.fromEntries(routes.map((r) => [r.number, shapes[r.number].map(encodePolyline)])));
await writeFile(SHAPES_PATH, json + "\n");
console.log(`Wrote shapes for ${routes.length} routes to ${SHAPES_PATH} (${(json.length / 1024).toFixed(0)} KB)`);

const names = new Map(routes.map((r) => [r.number, r.name]));
const lookalikes = findLookalikes(Object.fromEntries(routes.map((r) => [r.number, shapes[r.number]])), (n) => names.get(n));
await writeFile(LOOKALIKES_PATH, JSON.stringify(lookalikes, null, 2) + "\n");
console.log(`Wrote ${Object.values(lookalikes).flat().length / 2} lookalike pairs to ${LOOKALIKES_PATH}`);
