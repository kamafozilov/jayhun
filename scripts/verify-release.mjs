import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const directory = process.argv[2];
assert(directory, "usage: node scripts/verify-release.mjs <asset-directory>");
const feed = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(feed.version.replace(/^v/, ""), version);
const files = new Set(readdirSync(directory));
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const publicLines = Buffer.from(config.plugins.updater.pubkey, "base64")
  .toString()
  .trim()
  .split("\n");
const publicBytes = Buffer.from(publicLines[1], "base64");
const key = createPublicKey({
  key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    publicBytes.subarray(10),
  ]),
  format: "der",
  type: "spki",
});
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
  const signatureLines = Buffer.from(entry.signature, "base64")
    .toString()
    .trim()
    .split("\n");
  const signature = Buffer.from(signatureLines[1], "base64");
  assert.equal(
    signature.subarray(0, 2).toString(),
    "ED",
    "Expected a prehashed Ed25519 signature",
  );
  assert(
    signature.subarray(2, 10).equals(publicBytes.subarray(2, 10)),
    "Signing key mismatch",
  );
  const digest = createHash("blake2b512")
    .update(readFileSync(join(directory, asset)))
    .digest();
  assert(
    verify(null, digest, key, signature.subarray(10)),
    `Invalid signature: ${asset}`,
  );
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
