import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fluxHausIconElements, type FluxHausIcon } from "../src/front-art.js";
import { fluxHausPalette } from "../src/renderer.js";

const icons: readonly FluxHausIcon[] = [
  "washer",
  "dryer",
  "dishwasher",
  "broombot",
  "mopbot",
  "airPurifier",
  "car",
  "complete",
];

const artifact = {
  icons: Object.fromEntries(
    icons.map((icon) => [
      icon,
      fluxHausIconElements("generated", icon, fluxHausPalette(icon).icon).map((element) => ({
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        color: element.fill_colors[0],
      })),
    ]),
  ),
  palettes: Object.fromEntries(icons.map((icon) => [icon, fluxHausPalette(icon)])),
};

const output = `// Generated from src/front-art.ts and src/renderer.ts. Do not edit.\n` +
  `globalThis.FLUX_HAUS_ART = ${JSON.stringify(artifact, null, 2)};\n`;
const outputPath = fileURLToPath(
  new URL("../demo/fluxhaus-art.generated.js", import.meta.url),
);

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8");
  if (current !== output) {
    throw new Error("demo/fluxhaus-art.generated.js is stale; run pnpm demo:generate");
  }
} else {
  await writeFile(outputPath, output);
}
