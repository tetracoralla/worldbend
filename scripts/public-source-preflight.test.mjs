import assert from "node:assert/strict";
import childProcess,{execFileSync} from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectPublicCandidate } from "./public-source-preflight.mjs";

const cli = fileURLToPath(new URL("./public-source-preflight.mjs", import.meta.url));
const publicIdentity = { GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.com" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "worldbend-source-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, input, identity = publicIdentity) => execFileSync("git", args,
    { cwd: root, env: { ...process.env, ...identity }, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  git(["init", "-b", "public"]);
  await writeFile(path.join(root, "README.md"), "Public product\n");
  git(["add", "README.md"]); git(["commit", "-m", "Initial public source"]);
  const base = git(["rev-parse", "HEAD"]);
  const save = async (name, value) => {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), value);
    git(["add", "--", name]);
  };
  const policyPath = path.join(root, "private-policy.json");
  await writeFile(policyPath, JSON.stringify({ denyLiterals: ["EmployerConfidential"] }));
  return { root, git, save, base, policyPath,
    scan: (options = {}) => inspectPublicCandidate({ root, baseRef: base, candidateRef: "HEAD", policyPath, ...options }) };
}

test("a clean aggregate preserves the reviewed tree without publishing private lineage", async t => {
  const f = await fixture(t);
  f.git(["checkout", "-b", "private"]);
  await f.save("docs/record.md", "EmployerConfidential\n");
  f.git(["commit", "-m", "Internal work"], undefined, { ...publicIdentity, GIT_AUTHOR_EMAIL: "agent@localhost" });
  await f.save("docs/record.md", "Product-only contract\n");
  f.git(["commit", "-m", "Product-neutral source"]);
  const tip = f.git(["rev-parse", "HEAD"]), tree = f.git(["rev-parse", "HEAD^{tree}"]);
  const privateReport = await f.scan({ expectedNewCommits: 1, excludeHistoryRef: tip });
  assert.equal(privateReport.verdict, "FAIL");
  for (const category of ["private_literal", "private_commit_identity", "unexpected_history_size", "excluded_history"]) {
    assert(privateReport.findings.some(item => item.category === category));
  }
  const aggregate = f.git(["commit-tree", tree, "-p", f.base], "Product release\n");
  const report = await f.scan({ candidateRef: aggregate, expectedNewCommits: 1, excludeHistoryRef: tip });
  assert.equal(report.verdict, "PASS");
  assert.equal(report.newCommitCount, 1);
  assert(report.scannedObjects > report.treeFiles);
  assert.equal(f.git(["rev-parse", `${aggregate}^{tree}`]), tree);
  assert.equal(f.git(["rev-parse", "HEAD"]), tip, "audit must not move the working branch");
  assert.deepEqual(f.git(["status", "--porcelain"]), "?? private-policy.json");
});

test("a staged tree can be reviewed over the public base without a commit or private ancestry", async t => {
  const f=await fixture(t);
  await f.save("private.txt","EmployerConfidential\n");f.git(["commit","-m","Private development"],undefined,
    {...publicIdentity,GIT_AUTHOR_EMAIL:"agent@localhost"});
  const head=f.git(["rev-parse","HEAD"]);
  await f.save("private.txt","Public implementation\n");
  const tree=f.git(["write-tree"]),before=f.git(["status","--porcelain"]);
  const report=await f.scan({candidateRef:undefined,candidateTreeRef:tree,expectedNewCommits:0,excludeHistoryRef:head});
  assert.equal(report.verdict,"PASS");assert.equal(report.mode,"tree-over-public-base");
  assert.equal(report.candidateTree,tree);assert.equal(report.futureCommitMetadata,"not_created");
  assert.equal(report.newCommitCount,0);assert.equal(f.git(["rev-parse","HEAD"]),head);
  assert.equal(f.git(["status","--porcelain"]),before);
  const cliReport=JSON.parse(execFileSync(process.execPath,[cli,"--base",f.base,"--candidate-tree",tree],
    {cwd:f.root,encoding:"utf8"}));
  assert.equal(cliReport.verdict,"PASS");assert.equal(cliReport.candidateTree,tree);
  await assert.rejects(f.scan({candidateTreeRef:tree}),/E_CANDIDATE_MODE/);
});

test("tree preparation still scans new paths, blobs and all retained public history", async t => {
  const f=await fixture(t);
  await f.save("old.txt","EmployerConfidential\n");f.git(["commit","-m","Public history witness"]);
  const base=f.git(["rev-parse","HEAD"]);f.git(["rm","old.txt"]);
  await f.save(".task-notes/new.md",["ghp","A".repeat(36)].join("_")+"\n");
  const report=await f.scan({baseRef:base,candidateRef:undefined,candidateTreeRef:f.git(["write-tree"])});
  assert.equal(report.verdict,"FAIL");
  for(const category of ["private_literal","credential_pattern","private_work_record"]){
    assert(report.findings.some(item=>item.category===category),category);
  }
});

test("deleted credentials, private filenames and merge-only records remain visible", async t => {
  const f = await fixture(t), token = ["ghp", "A".repeat(36)].join("_");
  await f.save(".task-notes/EmployerConfidential.md", "harmless working note");
  await f.save(".env", "placeholder");
  await f.save("gone.txt", token);
  f.git(["commit", "-m", "Temporary files"]);
  f.git(["rm", "-r", ".task-notes", ".env", "gone.txt"]);
  f.git(["commit", "-m", "Remove temporary files"]);
  // A resolution-only path must be inspected even if neither parent had it.
  f.git(["checkout", "-b", "other", f.base]);
  await f.save("other.txt", "Other branch"); f.git(["commit", "-m", "Other change"]);
  f.git(["checkout", "public"]); f.git(["merge", "--no-commit", "--no-ff", "other"]);
  await f.save(".codex/sessions/session.jsonl", "session content");
  f.git(["commit", "-m", "Merge with extra record"]);
  const report = await f.scan(), output = JSON.stringify(report);
  assert.equal(report.verdict, "FAIL");
  for (const category of ["private_work_record", "credential_file", "credential_pattern", "private_literal"]) {
    assert(report.findings.some(item => item.category === category));
  }
  assert.equal(report.findings.filter(item => item.category === "private_work_record").length, 2);
  assert(!output.includes(token));
  assert(!output.includes("EmployerConfidential"));
  assert(!output.includes(f.root));
});

test("UTF-16 private metadata and local build paths are inspected as bytes", async t => {
  const f = await fixture(t);
  const le = Buffer.from("EmployerConfidential", "utf16le"), be = Buffer.from(le);
  be.swap16();
  await f.save("metadata.bin", Buffer.concat([le, Buffer.from([0]), be]));
  await f.save("diagnostic.txt", `${f.root}/source.rs`);
  f.git(["commit", "-m", "Binary metadata"]);
  const report = await f.scan();
  assert.equal(report.verdict, "FAIL");
  assert(report.findings.some(item => item.category === "private_literal" && item.objectType === "blob"));
  assert(report.findings.some(item => item.category === "local_build_path"));
});

test("short Unicode private names are valid policy literals, but an empty literal is not", async t => {
  const f = await fixture(t), marker = "秘企";
  await writeFile(f.policyPath, JSON.stringify({ denyLiterals: [marker] }));
  await f.save("private-name.txt", marker); f.git(["commit", "-m", "Unicode metadata"]);
  const report = await f.scan();
  assert.equal(report.verdict, "FAIL");
  assert(report.findings.some(item => item.category === "private_literal"));
  assert(!JSON.stringify(report).includes(marker));
  await writeFile(f.policyPath, JSON.stringify({ denyLiterals: [""] }));
  await assert.rejects(f.scan(), /E_POLICY/);
});

test("replacement objects cannot hide a credential in published Git objects", async t => {
  const f = await fixture(t), token = ["ghp", "B".repeat(36)].join("_");
  await f.save("credential.txt", token); f.git(["commit", "-m", "Original object"]);
  const original = f.git(["rev-parse", "HEAD:credential.txt"]);
  const substitute = f.git(["hash-object", "-w", "--stdin"], "not a credential\n");
  f.git(["replace", original, substitute]);
  assert.equal(f.git(["show", "HEAD:credential.txt"]), "not a credential");
  const report = await f.scan();
  assert.equal(report.verdict, "FAIL");
  assert(report.findings.some(item => item.category === "credential_pattern" && item.objectId === original));
});

test("valid provider configuration and public guidance are not private work records", async t => {
  const f = await fixture(t);
  for (const name of [".codex-plugin/plugin.json", ".mcp.json", "AGENTS.md", "docs/PRODUCT_MODEL.md", ".env.example"]) {
    await f.save(name, "Public configuration or guidance\n");
  }
  f.git(["commit", "-m", "Public source"]);
  assert.equal((await f.scan({ expectedNewCommits: 1 })).verdict, "PASS");
  assert.equal((await f.scan({ expectedNewCommits: 2 })).verdict, "FAIL");
  assert.equal((await f.scan({ baseRef: "HEAD", candidateRef: f.base })).verdict, "FAIL");
});

test("invalid inputs and unavailable scans never return a truncated or partial PASS", async t => {
  const f = await fixture(t);
  for (const candidateRef of ["-x", "missing-ref", "HEAD\n", ""]) {
    await assert.rejects(f.scan({ candidateRef }));
  }
  await assert.rejects(f.scan({ expectedNewCommits: -1 }));
  await writeFile(f.policyPath, JSON.stringify({ denyLiterals: [], unrecognized: true }));
  await assert.rejects(f.scan(), /E_POLICY/);
  await writeFile(f.policyPath, " ".repeat(1024 * 1024 + 1));
  await assert.rejects(f.scan(), /E_POLICY_SIZE/);
  for (const args of [[], ["--base", "HEAD", "--candidate", "HEAD", "--expected-new-commits", ""],
    ["--base", "HEAD", "--candidate", "HEAD", "--unknown", "secret-input"]]) {
    let output;
    try { execFileSync(process.execPath, [cli, ...args], { cwd: f.root, encoding: "utf8" }); }
    catch (error) { assert.equal(error.status, 3); output = error.stdout; }
    assert.equal(JSON.parse(output).verdict, "BLOCKED");
    assert(!output.includes("secret-input"));
  }
});

test("an uninspected submodule blocks the public-source verdict", async t => {
  const f = await fixture(t);
  f.git(["update-index", "--add", "--cacheinfo", `160000,${f.base},vendor/external`]);
  f.git(["commit", "-m", "External object graph"]);
  await assert.rejects(f.scan(), /E_SUBMODULE_UNSCANNED/);
});

test("shallow history cannot turn deleted private history into a PASS", async t => {
  const f = await fixture(t);
  await f.save("removed.txt", "EmployerConfidential");
  f.git(["commit", "-m", "Private ancestor"]);
  f.git(["rm", "removed.txt"]); f.git(["commit", "-m", "Clean tip"]);
  const tip = f.git(["rev-parse", "HEAD"]);
  const clone = path.join(f.root, "shallow-clone");
  f.git(["clone", "--no-local", "--depth=1", pathToFileURL(f.root).href, clone]);
  await assert.rejects(f.scan({ root: clone, baseRef: tip, expectedNewCommits: 0 }), /E_SHALLOW_HISTORY/);
});

test("local grafts cannot turn deleted private history into a PASS", async t => {
  const f = await fixture(t);
  await f.save("removed.txt", "EmployerConfidential");
  f.git(["commit", "-m", "Private ancestor"]);
  f.git(["rm", "removed.txt"]); f.git(["commit", "-m", "Clean tip"]);
  const tip = f.git(["rev-parse", "HEAD"]);
  await writeFile(path.join(f.root, ".git/info/grafts"), `${tip}\n`);
  await assert.rejects(f.scan({ baseRef: tip, expectedNewCommits: 0 }), /E_GRAFTED_HISTORY/);
});

test("annotated candidate tags include their publishable metadata in the scan", async t => {
  const f = await fixture(t);
  f.git(["tag", "-a", "candidate", "-m", "EmployerConfidential"]);
  const report = await f.scan({ candidateRef: "candidate", expectedNewCommits: 0 });
  assert.equal(report.verdict, "FAIL");
  assert(report.findings.some(item => item.category === "private_literal" && item.objectType === "tag"));
});

test("removed submodule source still blocks a complete historical scan", async t => {
  const f = await fixture(t);
  f.git(["update-index", "--add", "--cacheinfo", `160000,${f.base},vendor/external`]);
  f.git(["commit", "-m", "External object graph"]);
  f.git(["update-index", "--force-remove", "vendor/external"]);
  f.git(["commit", "-m", "Remove external graph"]);
  await assert.rejects(f.scan(), /E_SUBMODULE_UNSCANNED/);
});

test("a policy FIFO is rejected without waiting for a writer", {skip:process.platform==="win32"?"POSIX FIFO semantics are not native Windows filesystem semantics":false},async t=>{
  const f = await fixture(t), fifo = path.join(f.root, "policy-fifo");
  execFileSync("mkfifo", [fifo]);
  let failure;
  try {
    execFileSync(process.execPath, [cli, "--base", f.base, "--candidate", "HEAD", "--policy", fifo],
      { cwd: f.root, encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) { failure = error; }
  assert.equal(failure?.status, 3, "non-regular policy must fail before blocking on I/O");
  assert.equal(JSON.parse(failure.stdout).error, "E_POLICY_TYPE");
});

test("a native non-regular policy directory fails closed without waiting for I/O",async t=>{
  const f=await fixture(t),directory=path.join(f.root,"policy-directory");await mkdir(directory);
  let failure;
  try{execFileSync(process.execPath,[cli,"--base",f.base,"--candidate","HEAD","--policy",directory],
    {cwd:f.root,encoding:"utf8",timeout:2000,stdio:["pipe","pipe","pipe"]});}catch(error){failure=error;}
  assert.equal(failure?.status,3,"all supported native platforms must fail closed promptly");
  const receipt=JSON.parse(failure.stdout);
  assert.equal(receipt.verdict,"BLOCKED");
  assert(["E_POLICY_TYPE","E_POLICY_READ"].includes(receipt.error),"native refusal must identify policy admission, not a scan PASS");
});

test("UTF-16 credentials in binary metadata cannot bypass recognizable-secret detection", async t => {
  const f = await fixture(t), token = ["ghp", "C".repeat(36)].join("_");
  // Test an odd byte offset and both byte orders, as in binary resource tables.
  const le = Buffer.from(token, "utf16le"), be = Buffer.from(le); be.swap16();
  await f.save("metadata.bin", Buffer.concat([Buffer.from([1]), le, Buffer.from([0]), be]));
  f.git(["commit", "-m", "Binary resource"]);
  const report = await f.scan();
  assert.equal(report.verdict, "FAIL");
  assert(report.findings.some(item => item.category === "credential_pattern"));
  assert(!JSON.stringify(report).includes(token));
});

test("an oversized object is refused and the next ordinary scan still succeeds", async t => {
  const f = await fixture(t);
  await f.save("oversized.bin", Buffer.alloc(64 * 1024 * 1024 + 1));
  f.git(["commit", "-m", "Oversized source object"]);
  await assert.rejects(f.scan(), /E_OBJECT_SIZE/);
  assert.equal((await f.scan({ candidateRef: f.base })).verdict, "PASS");
});

test("moving a candidate ref after resolution cannot pair one tree with another graph", async t => {
  const f = await fixture(t);
  await f.save("private.txt", "EmployerConfidential");
  f.git(["commit", "-m", "Private candidate"]);
  const original = f.git(["rev-parse", "HEAD"]);
  const clean = f.git(["commit-tree", f.git(["rev-parse", `${f.base}^{tree}`]), "-p", f.base], "Clean candidate\n");
  f.git(["update-ref", "refs/heads/moving-candidate", original]);
  const realSpawn=childProcess.spawn;let moved=false,intercepted=0,report;
  try{
    // Native Node on Windows does not execute extensionless POSIX wrappers.
    // Intercept only the real child's completion, after stdout resolved the
    // original ref and before the scanner consumes its result. No fake Git
    // output, sleeps, altered scan logic, or PATH-dependent shell semantics.
    childProcess.spawn=function(command,args,options){
      const child=realSpawn.call(this,command,args,options);
      if(command==="git"&&args.includes("rev-parse")&&
        args.some(v=>v==="moving-candidate"||v==="moving-candidate^{commit}")){
        intercepted++;
        child.once("close",code=>{
          assert.equal(code,0,"the real Git resolution must succeed");
          if(!moved){f.git(["update-ref","refs/heads/moving-candidate",clean]);moved=true;}
        });
      }
      return child;
    };
    syncBuiltinESMExports();
    report=await f.scan({candidateRef:"moving-candidate",expectedNewCommits:1});
  }finally{childProcess.spawn=realSpawn;syncBuiltinESMExports();}
  assert.equal(moved,true,"the real ref must move at the controlled resolution boundary");
  assert(intercepted>=1,"the scanner must actually resolve the candidate through native Git");
  assert.equal(f.git(["rev-parse", "moving-candidate"]), clean, "the controlled move must actually occur");
  assert.equal(report.verdict, "FAIL");
  assert.equal(report.candidate, original);
  assert.equal(report.candidateObject, original);
  assert(report.findings.some(item => item.category === "private_literal"));
  assert.equal((await f.scan({ candidateRef: "moving-candidate", expectedNewCommits: 1 })).verdict, "PASS",
    "a later scan resolves and consistently audits the new clean candidate");
});
