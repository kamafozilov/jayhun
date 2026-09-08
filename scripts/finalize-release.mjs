import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
assert(directory, "usage: node scripts/finalize-release.mjs <asset-directory>");
const metadata = JSON.parse(
  readFileSync(join(directory, "release.json"), "utf8"),
);
const feedPath = join(directory, "latest.json");
const feed = JSON.parse(readFileSync(feedPath, "utf8"));
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(metadata.draft, true, "Only draft releases may be changed");
assert.equal(metadata.tag_name, `v${version}`);
const downloadUrl = (asset) =>
  `https://github.com/kamafozilov/jayhun/releases/download/${metadata.tag_name}/${encodeURIComponent(asset.name)}`;
for (const entry of Object.values(feed.platforms)) {
  const asset = metadata.assets.find(
    (asset) =>
      asset.url === entry.url ||
      asset.browser_download_url === entry.url ||
      downloadUrl(asset) === entry.url,
  );
  assert(asset, `Unknown release asset: ${entry.url}`);
  entry.url = downloadUrl(asset);
}
feed.notes = readFileSync("docs/release-notes.md", "utf8").trim();
writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`);
