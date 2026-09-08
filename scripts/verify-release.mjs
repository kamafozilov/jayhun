import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const directory = process.argv[2];
assert(directory, "usage: node scripts/verify-release.mjs <asset-directory>");
const feed = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(feed.version.replace(/^v/, ""), version);
const files = new Set(readdirSync(directory));
for (const platform of [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
  "windows-x86_64",
]) {
  const entry = feed.platforms[platform];
  assert(entry, `Missing platform: ${platform}`);
  const url = new URL(entry.url);
  assert.equal(url.origin, "https://github.com");
  assert(
    url.pathname.startsWith(
      `/kamafozilov/jayhun/releases/download/v${version}/`,
    ),
  );
  const asset = decodeURIComponent(basename(url.pathname));
  assert(files.has(asset), `Missing asset: ${asset}`);
  assert(files.has(`${asset}.sig`), `Missing signature: ${asset}`);
  assert.equal(
    entry.signature.trim(),
    readFileSync(join(directory, `${asset}.sig`), "utf8").trim(),
  );
  assert(
    Buffer.from(entry.signature, "base64").toString().includes("signature"),
    "Invalid signature encoding",
  );
}
console.log(
  `Verified Jayhun ${version}: all four update targets and signatures are present.`,
);
