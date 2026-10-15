import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SCAN_BYTES = 256 * 1024 * 1024;
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

class PreflightError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Capture complete Git output or refuse the scan; never truncate to a PASS. */
async function git(root, args, input, limit = MAX_SCAN_BYTES) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1" };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[name];
    const child = spawn("git", ["--no-replace-objects", ...args], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0, failure;
    const stop = code => { failure ??= new PreflightError(code); child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop("E_GIT_TIMEOUT"), 120_000);
    child.on("error", () => { failure ??= new PreflightError("E_GIT_UNAVAILABLE"); });
    child.stdin.on("error", () => { failure ??= new PreflightError("E_GIT_INPUT"); });
    child.stderr.resume(); // Diagnostics can contain paths or input; do not echo them.
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > limit) stop("E_SCAN_SIZE");
      else chunks.push(chunk);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new PreflightError("E_GIT_READ"));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

function lines(bytes) { return bytes.toString("utf8").trim().split("\n").filter(Boolean); }
function ref(value) {
  if (typeof value !== "string" || !value || value.startsWith("-") ||
      value.length > 1024 || /[\0\r\n]/.test(value)) throw new PreflightError("E_REF");
  return value;
}
async function object(root, value, suffix = "") {
  const sha = (await git(root, ["rev-parse", "--verify", "--end-of-options", `${ref(value)}${suffix}`], undefined, 4096)).toString("utf8").trim();
  if (!HASH.test(sha)) throw new PreflightError("E_REF");
  return sha;
}
async function commit(root, value) { return object(root, value, "^{commit}"); }

async function requireFullHistory(root) {
  const shallow = (await git(root, ["rev-parse", "--is-shallow-repository"], undefined, 4096)).toString("utf8").trim();
  if (shallow !== "false") throw new PreflightError("E_SHALLOW_HISTORY");
  const grafts = (await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "info/grafts"], undefined, 16_384)).toString("utf8").trim();
  try { await lstat(grafts); }
  catch (error) {
    if (error.code === "ENOENT") return;
    throw new PreflightError("E_HISTORY_READ");
  }
  throw new PreflightError("E_GRAFTED_HISTORY");
}

async function policyFrom(file) {
  if (!file) return { denyLiterals: [] };
  let value, handle;
  try {
    // Nonblocking admission prevents a FIFO from waiting for a policy writer.
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new PreflightError("E_POLICY_TYPE");
    const size = stat.size;
    if (size > 1024 * 1024) throw new PreflightError("E_POLICY_SIZE");
    const bytes = Buffer.alloc(size + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > size) throw new PreflightError("E_POLICY_SIZE");
    value = JSON.parse(bytes.subarray(0, used).toString("utf8"));
  }
  catch (error) {
    if (error instanceof PreflightError) throw error;
    throw new PreflightError("E_POLICY_READ");
  }
  finally { await handle?.close(); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => key !== "denyLiterals") ||
      !Array.isArray(value.denyLiterals) || value.denyLiterals.length > 128 ||
      value.denyLiterals.some(item => typeof item !== "string" || item.length === 0 || item.length > 2048)) {
    throw new PreflightError("E_POLICY");
  }
  return value;
}

function utf16be(value) {
  const bytes = Buffer.from(value, "utf16le");
  for (let n = 0; n < bytes.length; n += 2) [bytes[n], bytes[n + 1]] = [bytes[n + 1], bytes[n]];
  return bytes;
}

function* textRepresentations(bytes, utf8) {
  yield utf8;
  if (!bytes.includes(0)) return;
  // Binary metadata can place UTF-16 strings at either byte alignment.
  for (const offset of [0, 1]) {
    yield bytes.subarray(offset).toString("utf16le");
    const end = bytes.length - (bytes.length - offset) % 2;
    const be = Buffer.from(bytes.subarray(offset, end));
    be.swap16();
    yield be.toString("utf16le");
  }
}

/** Read-only candidate audit. Private literal policy stays outside the public tree. */
export async function inspectPublicCandidate({ root = process.cwd(), baseRef, candidateRef,
  candidateTreeRef, excludeHistoryRef, expectedNewCommits, policyPath, localRoots = [] }) {
  const treeOnly = candidateTreeRef !== undefined;
  if (treeOnly === (candidateRef !== undefined)) throw new PreflightError("E_CANDIDATE_MODE");
  const policy = await policyFrom(policyPath);
  const repository = (await git(root, ["rev-parse", "--show-toplevel"], undefined, 16_384)).toString("utf8").trim();
  await requireFullHistory(repository);
  const base = await commit(repository, baseRef);
  const candidateObject = await object(repository, treeOnly ? candidateTreeRef : candidateRef, treeOnly ? "^{tree}" : "");
  // Resolve the named candidate once; all later reads use its immutable object.
  // A staged tree can be audited over an existing public base without making
  // an unapproved commit or pulling private development ancestry into it.
  const candidate = treeOnly ? base : await commit(repository, candidateObject);
  const newCommits = lines(await git(repository, ["rev-list", candidate, `^${base}`], undefined, 4 * 1024 * 1024));
  const findings = [];
  const finding = (category, details = {}) => findings.push({ category, ...details });
  const ancestors = new Set(lines(await git(repository, ["rev-list", candidate], undefined, 4 * 1024 * 1024)));
  if (!ancestors.has(base)) finding("base_not_ancestor");
  if (expectedNewCommits !== undefined && (!Number.isSafeInteger(expectedNewCommits) || expectedNewCommits < 0)) {
    throw new PreflightError("E_EXPECTED_COMMITS");
  }
  if (expectedNewCommits !== undefined && newCommits.length !== expectedNewCommits) finding("unexpected_history_size");
  if (excludeHistoryRef) {
    const excluded = await commit(repository, excludeHistoryRef);
    const privateCommits = new Set(lines(await git(repository, ["rev-list", excluded, `^${base}`], undefined, 4 * 1024 * 1024)));
    for (const sha of newCommits) if (privateCommits.has(sha)) finding("excluded_history", { objectId: sha });
  }
  const entries = (await git(repository, ["ls-tree", "-r", "-z", "--full-tree", candidateObject], undefined, 8 * 1024 * 1024))
    .toString("utf8").split("\0").filter(Boolean).map(line => {
      const split = line.indexOf("\t"), header = line.slice(0, split).split(" ");
      if (split < 0 || header.length !== 3 || !HASH.test(header[2])) throw new PreflightError("E_TREE");
      return { mode: header[0], type: header[1], id: header[2], path: line.slice(split + 1) };
    });
  for (const entry of entries) {
    if (entry.type === "commit") throw new PreflightError("E_SUBMODULE_UNSCANNED");
  }
  // Changed paths across every parent, including merge resolutions and deletions.
  const historicalPaths = new Set((await git(repository,
    ["log", "-m", "--root", "--no-show-signature", "--no-notes", "--format=", "--name-only", "-z", "--no-renames", candidate], undefined, 8 * 1024 * 1024))
    .toString("utf8").split("\0").filter(Boolean).concat(entries.map(entry => entry.path)));
  for (const name of historicalPaths) {
    // A filename can itself contain a secret or private name: emit only its hash.
    const pathHash = createHash("sha256").update(name).digest("hex");
    if (/(?:^|\/)\.task-notes(?:\/|$)|(?:^|\/)\.git(?:\/|$)|(?:^|\/)rollout-\d{4}-\d{2}-\d{2}.*\.jsonl$|(?:^|\/)\.codex\/sessions\//.test(name)) {
      finding("private_work_record", { pathHash });
    }
    if (/(?:^|\/)\.env(?:\.[^/]+)?$/.test(name) && !/\.env\.(?:example|sample|template)$/.test(name)) {
      finding("credential_file", { pathHash });
    }
  }
  // All candidate-reachable objects, including old/deleted files and metadata.
  const ids = [...new Set(lines(await git(repository, ["rev-list", "--objects", "--no-object-names", candidateObject,
    ...(treeOnly ? [base] : [])], undefined, 8 * 1024 * 1024)))];
  if (!ids.every(id => HASH.test(id))) throw new PreflightError("E_OBJECT_LIST");
  const reachable = new Set(ids);
  if (!reachable.has(candidateObject)) throw new PreflightError("E_OBJECT_LIST");
  const batch = await git(repository, ["cat-file", "--batch"], `${ids.join("\n")}\n`);
  const roots = [...new Set([repository, path.resolve(root), homedir(), ...localRoots].filter(value =>
    typeof value === "string" && value.length > 3 && path.isAbsolute(value)))];
  const literals = policy.denyLiterals.map(value => ({ lower: value.toLowerCase(),
    utf8: Buffer.from(value), le: Buffer.from(value, "utf16le"), be: utf16be(value) }));
  let offset = 0, scannedBytes = 0;
  for (const id of ids) {
    const newline = batch.indexOf(10, offset);
    if (newline < 0) throw new PreflightError("E_OBJECT_READ");
    const header = batch.subarray(offset, newline).toString("ascii").split(" ");
    const size = Number(header[2]), type = header[1];
    if (header.length !== 3 || header[0] !== id || !["blob", "commit", "tree", "tag"].includes(type) ||
        !Number.isSafeInteger(size) || size < 0 || size > MAX_OBJECT_BYTES) throw new PreflightError("E_OBJECT_SIZE");
    const end = newline + 1 + size;
    if (end >= batch.length || batch[end] !== 10) throw new PreflightError("E_OBJECT_READ");
    const bytes = batch.subarray(newline + 1, end), text = bytes.toString("utf8");
    // Verify closure using original object bytes, not only rev-list's local view.
    // This also guards against history-shaping configuration changing mid-scan.
    const requireObject = sha => {
      if (!HASH.test(sha) || !reachable.has(sha)) throw new PreflightError("E_INCOMPLETE_GRAPH");
    };
    if (type === "commit" || type === "tag") {
      const metadata = text.split("\n\n", 1)[0].split("\n");
      const first = type === "commit" ? "tree " : "object ";
      if (!metadata[0].startsWith(first)) throw new PreflightError("E_OBJECT_READ");
      requireObject(metadata[0].slice(first.length));
      if (type === "commit") for (const line of metadata) if (line.startsWith("parent ")) requireObject(line.slice(7));
    }
    if (type === "tree") {
      let cursor = 0;
      while (cursor < bytes.length) {
        const space = bytes.indexOf(32, cursor), nul = bytes.indexOf(0, cursor);
        if (space < cursor || nul <= space || nul + 1 + id.length / 2 > bytes.length) throw new PreflightError("E_OBJECT_READ");
        if (bytes.subarray(cursor, space).toString("ascii") === "160000") throw new PreflightError("E_SUBMODULE_UNSCANNED");
        const next = nul + 1 + id.length / 2;
        requireObject(bytes.subarray(nul + 1, next).toString("hex"));
        cursor = next;
      }
    }
    const details = { objectId: id, objectType: type };
    let localPath = false, privateLiteral = literals.some(value => bytes.includes(value.utf8) || bytes.includes(value.le) || bytes.includes(value.be)), credential = false;
    for (const representation of textRepresentations(bytes, text)) {
      if (!localPath) localPath = roots.some(value => representation.includes(value));
      if (!privateLiteral && literals.length) {
        const lower = representation.toLowerCase();
        privateLiteral = literals.some(value => lower.includes(value.lower));
      }
      if (!credential) credential = /(?:\bgh[pousr]_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{70,255}\b|\bAKIA[A-Z0-9]{16}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{40,255}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(representation);
      if (localPath && privateLiteral && credential) break;
    }
    if (localPath) finding("local_build_path", details);
    if (privateLiteral) finding("private_literal", details);
    if (credential) finding("credential_pattern", details);
    if (type === "commit" && /^(?:author|committer) .*<[^>]*@(?:localhost|localdomain)>/m.test(text)) finding("private_commit_identity", details);
    if (type === "tag" && /^tagger .*<[^>]*@(?:localhost|localdomain)>/m.test(text)) finding("private_tag_identity", details);
    scannedBytes += size;
    offset = end + 1;
  }
  if (offset !== batch.length) throw new PreflightError("E_OBJECT_READ");
  return { verdict: findings.length ? "FAIL" : "PASS", base, candidate, candidateObject,
    ...(treeOnly ? {mode:"tree-over-public-base",candidateTree:candidateObject,futureCommitMetadata:"not_created"} : {}),
    newCommitCount: newCommits.length,
    treeFiles: entries.length, scannedObjects: ids.length, scannedBytes, findings };
}

async function main() {
  try {
    const options = {};
    const names = { "--base": "baseRef", "--candidate": "candidateRef", "--candidate-tree": "candidateTreeRef", "--exclude-history": "excludeHistoryRef",
      "--policy": "policyPath", "--expected-new-commits": "expectedNewCommits" };
    const args = process.argv.slice(2);
    for (let n = 0; n < args.length; n += 2) {
      const key = names[args[n]], value = args[n + 1];
      if (!key || value === undefined || Object.hasOwn(options, key)) throw new PreflightError("E_USAGE");
      if (key === "expectedNewCommits" && !/^(?:0|[1-9]\d*)$/.test(value)) throw new PreflightError("E_EXPECTED_COMMITS");
      options[key] = key === "expectedNewCommits" ? Number(value) : value;
    }
    if (!options.baseRef || (!options.candidateRef && !options.candidateTreeRef)) throw new PreflightError("E_USAGE");
    const report = await inspectPublicCandidate(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.verdict === "PASS" ? 0 : 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ verdict: "BLOCKED", error: error instanceof PreflightError ? error.code : "E_PREFLIGHT" })}\n`);
    process.exitCode = 3;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
