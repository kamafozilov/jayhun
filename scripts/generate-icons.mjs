import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error(
    "Run icon generation on macOS; the installer bitmap uses sips.",
  );
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), "jayhun-icons-"));
const icons = join(root, "src-tauri/icons");
try {
  execFileSync(
    join(root, "node_modules/.bin/tauri"),
    ["icon", join(root, "public/jayhun.svg"), "--output", output],
    { stdio: "inherit" },
  );
  for (const entry of readdirSync(output, { withFileTypes: true })) {
    if (entry.isFile())
      copyFileSync(join(output, entry.name), join(icons, entry.name));
  }
  copyFileSync(join(icons, "icon.png"), join(root, "public/jayhun.png"));
  const sidebar = join(output, "sidebar.png");
  execFileSync("sips", [
    "-z",
    "120",
    "120",
    join(icons, "icon.png"),
    "--out",
    sidebar,
  ]);
  execFileSync("sips", [
    "-p",
    "314",
    "164",
    "--padColor",
    "102A43",
    sidebar,
    "--out",
    sidebar,
  ]);
  execFileSync("sips", [
    "-s",
    "format",
    "bmp",
    sidebar,
    "--out",
    join(icons, "installer-sidebar.bmp"),
  ]);
  // Match the original installer format: uncompressed 24-bit Windows BMP.
  const bitmapPath = join(icons, "installer-sidebar.bmp");
  const source = readFileSync(bitmapPath);
  const width = source.readInt32LE(18);
  const signedHeight = source.readInt32LE(22);
  const height = Math.abs(signedHeight);
  if (
    source.toString("ascii", 0, 2) !== "BM" ||
    source.readUInt16LE(28) !== 32
  ) {
    throw new Error("Expected a 32-bit BMP from sips.");
  }
  const offset = source.readUInt32LE(10);
  const stride = Math.ceil((width * 3) / 4) * 4;
  const bitmap = Buffer.alloc(54 + stride * height);
  bitmap.write("BM");
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeUInt32LE(54, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(width, 18);
  bitmap.writeInt32LE(height, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(24, 28);
  bitmap.writeUInt32LE(stride * height, 34);
  const background = [0x43, 0x2a, 0x10];
  for (let row = 0; row < height; row++) {
    const sourceRow = signedHeight < 0 ? height - 1 - row : row;
    for (let col = 0; col < width; col++) {
      const pixel = offset + (sourceRow * width + col) * 4;
      const alpha = source[pixel + 3] / 255;
      for (let channel = 0; channel < 3; channel++) {
        bitmap[54 + row * stride + col * 3 + channel] = Math.round(
          source[pixel + channel] * alpha + background[channel] * (1 - alpha),
        );
      }
    }
  }
  writeFileSync(bitmapPath, bitmap);
} finally {
  rmSync(output, { recursive: true, force: true });
}
