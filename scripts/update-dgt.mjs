import { mkdir, writeFile } from "node:fs/promises";

const SOURCE = "https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml";
const response = await fetch(SOURCE, { headers: { "user-agent": "Via-Clara/1.0 traffic-data importer" } });
if (!response.ok) throw new Error(`DGT responded with ${response.status}`);
const xml = await response.text();

const value = (block, tag) => {
  const match = block.match(new RegExp(`<[^:>]+:${tag}(?:\\s[^>]*)?>([^<]+)</[^:>]+:${tag}>`));
  return match?.[1]?.trim() ?? "";
};

const kindFor = (block) => {
  const text = block.toLowerCase();
  if (text.includes("accident")) return "accident";
  if (text.includes("roadworks") || text.includes("roadmaintenance")) return "works";
  if (text.includes("abnormaltraffic") || text.includes("trafficcongestion") || text.includes("queuingtraffic")) return "traffic";
  if (text.includes("vehicleobstruction") || text.includes("brokenDownvehicle".toLowerCase())) return "vehicle";
  return "hazard";
};

const incidents = [];
for (const match of xml.matchAll(/<sit:situation\s+id="([^"]+)"[\s\S]*?<\/sit:situation>/g)) {
  const [, id] = match;
  const block = match[0];
  const latitude = Number(value(block, "latitude"));
  const longitude = Number(value(block, "longitude"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
  incidents.push({
    id: `dgt-${id}`,
    kind: kindFor(block),
    coordinates: [longitude, latitude],
    createdAt: Date.parse(value(block, "situationRecordVersionTime")) || Date.now(),
    confirmations: 1,
    source: "DGT",
    road: value(block, "roadName"),
    municipality: value(block, "municipality"),
    province: value(block, "province"),
  });
}

await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../public/dgt-incidents.json", import.meta.url),
  `${JSON.stringify({ updatedAt: new Date().toISOString(), incidents })}\n`,
);
console.log(`Saved ${incidents.length} active DGT incidents`);
