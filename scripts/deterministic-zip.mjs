import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { unzipSync, zipSync } from "fflate";

const defaultArchiveTimestamp = new Date("1980-01-01T00:00:00.000Z");

function assertSafeArchivePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
  }
}

export async function writeDeterministicZip({
  archivePath,
  sourceRoot,
  rootName,
  entries,
  executableEntries = [],
  timestamp = defaultArchiveTimestamp,
}) {
  assertSafeArchivePath(rootName, "ZIP root name");

  const sortedEntries = [...new Set(entries)].sort();
  if (sortedEntries.length !== entries.length) {
    throw new Error("ZIP entries must be unique");
  }
  const executableSet = new Set(executableEntries);
  if (executableSet.size !== executableEntries.length) {
    throw new Error("Executable ZIP entries must be unique");
  }
  for (const entry of executableSet) {
    assertSafeArchivePath(entry, "executable ZIP entry");
    if (!sortedEntries.includes(entry)) {
      throw new Error(`Executable ZIP entry is not in the inventory: ${entry}`);
    }
  }

  const archiveEntries = {};
  for (const entry of sortedEntries) {
    assertSafeArchivePath(entry, "ZIP entry");
    const bytes = await readFile(
      path.join(sourceRoot, ...entry.split("/")),
    );
    archiveEntries[`${rootName}/${entry}`] = executableSet.has(entry)
      ? [bytes, { os: 3, attrs: 0o755 << 16 }]
      : bytes;
  }

  const archiveBytes = zipSync(archiveEntries, {
    level: 9,
    mtime: timestamp,
  });
  await writeFile(archivePath, archiveBytes);

  return Object.keys(unzipSync(archiveBytes))
    .filter((entry) => !entry.endsWith("/"))
    .sort();
}
