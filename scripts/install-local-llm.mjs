import fs from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

// Fetch only the CPU runtime from the official Windows portable archive.
// The complete archive also includes large GPU libraries this machine does not need.
const archive =
  "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip";
const head = await fetch(archive, { method: "HEAD" });
if (!head.ok) throw new Error("Official archive unavailable");
const size = Number(head.headers.get("content-length"));
if (!Number.isSafeInteger(size) || size < 65557) throw new Error("Invalid archive size");
const tailResponse = await fetch(head.url, {
  headers: { Range: `bytes=${size - 65557}-${size - 1}` },
});
if (tailResponse.status !== 206)
  throw new Error("Archive server does not support partial downloads");
const url = tailResponse.url;
const tail = Buffer.from(await tailResponse.arrayBuffer());
let end = tail.length - 22;
while (end >= 0 && tail.readUInt32LE(end) !== 0x06054b50) end--;
if (end < 0) throw new Error("ZIP directory missing");
const directorySize = tail.readUInt32LE(end + 12);
const directoryOffset = tail.readUInt32LE(end + 16);
async function range(start, length) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (response.status !== 206) throw new Error("Partial download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== length) throw new Error("Incomplete archive entry");
  return bytes;
}
const directory = await range(directoryOffset, directorySize);
const entries = [];
for (let offset = 0; offset < directory.length;) {
  if (directory.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid archive directory");
  const nameLength = directory.readUInt16LE(offset + 28);
  const extraLength = directory.readUInt16LE(offset + 30);
  const commentLength = directory.readUInt16LE(offset + 32);
  entries.push({
    name: directory
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8")
      .replaceAll("\\", "/"),
    method: directory.readUInt16LE(offset + 10),
    crc: directory.readUInt32LE(offset + 16),
    compressed: directory.readUInt32LE(offset + 20),
    uncompressed: directory.readUInt32LE(offset + 24),
    offset: directory.readUInt32LE(offset + 42),
  });
  offset += 46 + nameLength + extraLength + commentLength;
}
if (process.argv.includes("--list")) {
  console.log(JSON.stringify({ size, entries }, null, 2));
} else {
  const selected = entries.filter(
    ({ name }) =>
      name === "ollama.exe" ||
      (/^lib\/ollama\/[^/]+$/.test(name) &&
        /\.(dll|exe)$|LICENSE|NOTICE/.test(name) &&
        !/cuda|cublas|cudart|hip|rocm|vulkan/i.test(name)),
  );
  if (!selected.some(({ name }) => name === "ollama.exe"))
    throw new Error("CPU executable missing");
  const root = path.resolve(".local-llm/runtime");
  for (const entry of selected) {
    const target = path.resolve(root, entry.name);
    if (!target.startsWith(root + path.sep)) throw new Error("Unsafe archive path");
    const header = await range(entry.offset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error("Invalid archive entry");
    const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    console.log(`Downloading ${entry.name} (${Math.round(entry.compressed / 1024 / 1024)} MB)`);
    const compressed = await range(start, entry.compressed);
    const data =
      entry.method === 8 ? inflateRawSync(compressed) : entry.method === 0 ? compressed : null;
    if (!data || data.length !== entry.uncompressed) throw new Error("Invalid file size");
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== entry.crc) throw new Error("Archive CRC check failed");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
  console.log("Official Ollama CPU runtime installed in .local-llm/runtime");
}
