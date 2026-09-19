#!/usr/bin/env node
// Lens visual diff: compare base vs head screenshots with pixelmatch.
//
// Usage: node diff.js <name-prefix>
// Reads <name>-base-{desktop,mobile}.png and <name>-{desktop,mobile}.png
// from the working directory and writes <name>-{desktop,mobile}-diff.png.
// Also appends a short summary to GITHUB_STEP_SUMMARY when available.
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");

// Compare two PNG files and write a pixelmatch diff image.
// Returns the number of changed pixels, or null when the pair was skipped
// (e.g. different dimensions). Throws on missing/unreadable inputs.
function diffPair(baseFile, headFile, outFile) {
  for (const f of [baseFile, headFile]) {
    if (!fs.existsSync(f)) {
      throw new Error(`lens: missing input file: ${f}`);
    }
  }
  const base = PNG.sync.read(fs.readFileSync(baseFile));
  const head = PNG.sync.read(fs.readFileSync(headFile));

  if (base.width !== head.width || base.height !== head.height) {
    console.warn(
      `lens: skipping ${path.basename(outFile)} — dimensions differ ` +
        `(${base.width}x${base.height} vs ${head.width}x${head.height})`
    );
    return null;
  }

  const diff = new PNG({ width: base.width, height: base.height });
  const changed = pixelmatch(base.data, head.data, diff.data, base.width, base.height, {
    threshold: 0.1,
  });
  fs.writeFileSync(outFile, PNG.sync.write(diff));
  console.log(`lens: ${path.basename(outFile)} — ${changed} pixels changed`);
  return changed;
}

function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: node diff.js <name-prefix>");
    process.exit(1);
  }

  const results = [];
  for (const viewport of ["desktop", "mobile"]) {
    const changed = diffPair(
      `${name}-base-${viewport}.png`,
      `${name}-${viewport}.png`,
      `${name}-${viewport}-diff.png`
    );
    results.push([viewport, changed]);
  }

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const lines = ["### Lens visual diff"];
    for (const [viewport, changed] of results) {
      lines.push(
        changed === null
          ? `- ${viewport}: skipped (screenshot dimensions differ)`
          : `- ${viewport}: ${changed} pixels changed`
      );
    }
    fs.appendFileSync(summaryFile, lines.join("\n") + "\n");
  }
}

if (require.main === module) {
  main();
}

module.exports = { diffPair };
