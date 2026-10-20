import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function load(relative) {
  return JSON.parse(readFileSync(path.join(root, relative), 'utf8'))
}

class Client {
  #child
  #buffer = ''
  #next = 1
  #pending = new Map()
  #invalidLines = 0

  constructor(command) {
    this.#child = spawn(command, ['--root', root], { stdio: ['pipe', 'pipe', 'inherit'] })
    this.#child.stdout.on('data', (chunk) => this.#read(chunk))
  }

  request(method, params) {
    const id = this.#next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000)
      this.#pending.set(id, { resolve, timer })
      this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  notify(method, params) {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  sendRaw(line) {
    this.#child.stdin.write(line)
  }

  get invalidLines() {
    return this.#invalidLines
  }

  close() {
    this.#child.kill()
  }

  #read(chunk) {
    this.#buffer += chunk
    let newline
    while ((newline = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, newline)
      this.#buffer = this.#buffer.slice(newline + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        // A server whose protocol state dies on one bad line would strand
        // every in-flight request. Tolerate the line, count it, and let the
        // malformed-line check below prove the connection still works.
        this.#invalidLines += 1
        continue
      }
      const pending = this.#pending.get(message.id)
      if (!pending) continue
      clearTimeout(pending.timer)
      this.#pending.delete(message.id)
      pending.resolve(message)
    }
  }
}

// A minimal structural validator for the Profile snapshots: enough JSON Schema
// vocabulary (type, required, properties, additionalProperties, const, enum,
// $ref/$defs, string/number/array bounds) to prove the adapter's actual
// response bodies still conform to the published output contracts.
function validateAgainstSnapshot(value, schema, defs, path) {
  const where = path || '$'
  assert.ok(schema && typeof schema === 'object', `${where}: missing schema`)
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()
    return validateAgainstSnapshot(value, defs[name], defs, where)
  }
  if (schema.const !== undefined) {
    assert.deepEqual(value, schema.const, `${where}: expected const ${JSON.stringify(schema.const)}`)
    return
  }
  if (schema.enum !== undefined) {
    assert.ok(
      schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value)),
      `${where}: ${JSON.stringify(value)} is outside enum [${schema.enum.join(',')}]`,
    )
    return
  }
  if (schema.type !== undefined) {
    const matches =
      (schema.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) ||
      (schema.type === 'array' && Array.isArray(value)) ||
      (schema.type === 'string' && typeof value === 'string') ||
      (schema.type === 'number' && typeof value === 'number') ||
      (schema.type === 'integer' && Number.isInteger(value)) ||
      (schema.type === 'boolean' && typeof value === 'boolean')
    assert.ok(matches, `${where}: expected ${schema.type}, got ${typeof value}`)
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, `${where}: shorter than minLength`)
    if (schema.maxLength !== undefined) assert.ok(value.length <= schema.maxLength, `${where}: longer than maxLength`)
    if (schema.pattern !== undefined) assert.ok(new RegExp(schema.pattern).test(value), `${where}: does not match ${schema.pattern}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${where}: below minimum`)
    if (schema.exclusiveMinimum !== undefined) assert.ok(value > schema.exclusiveMinimum, `${where}: below exclusiveMinimum`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, `${where}: fewer than minItems`)
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, `${where}: more than maxItems`)
    if (schema.items !== undefined) {
      value.forEach((item, index) => validateAgainstSnapshot(item, schema.items, defs, `${where}[${index}]`))
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required !== undefined) {
      for (const name of schema.required) {
        assert.ok(name in value, `${where}: missing required property "${name}"`)
      }
    }
    if (schema.properties !== undefined) {
      for (const [name, property] of Object.entries(schema.properties)) {
        if (name in value) validateAgainstSnapshot(value[name], property, defs, `${where}.${name}`)
      }
    }
    if (schema.additionalProperties === false && schema.properties !== undefined) {
      for (const name of Object.keys(value)) {
        assert.ok(name in schema.properties, `${where}: unexpected property "${name}" outside the snapshot`)
      }
    }
  }
}

function validateAdapterOutput(operation, result) {
  const snapshot = load(`capabilities/schemas/projective.${operation}.output.schema.json`)
  validateAgainstSnapshot(result, snapshot, snapshot.$defs || {}, `${operation} output`)
}

// The manifest resolves its adapter and probe relative to capabilities/, so
// the prebuilt binaries must exist at the repository root bin/ before the
// central conformance runners spawn them. Prefer the staged release binaries
// that `pnpm check` builds immediately before this check so Capability
// conformance validates the bytes that actually ship; fall back to a fresh
// debug build for standalone runs.
const stagedBinDir = path.join(root, 'plugins', 'worldbend', 'bin')
let debugBuilt = false
function debugBinary(name) {
  if (!debugBuilt) {
    const built = spawnSync('cargo', ['build', '-p', 'worldbend-cli', '-p', 'worldbend-mcp'], {
      cwd: root,
      stdio: 'inherit',
    })
    assert.equal(built.status, 0, 'Worldbend capability binaries did not build')
    debugBuilt = true
  }
  const produced = path.join(root, 'target', 'debug', name)
  assert.ok(existsSync(produced), `${name} was not produced by the cargo build`)
  return produced
}
mkdirSync(path.join(root, 'bin'), { recursive: true })
// The adapter resolves its Worldbend CLI as a sibling executable, so all
// four staged binaries must be provisioned together.
for (const name of [
  'worldbend',
  'worldbend-capability',
  'worldbend-mcp',
  'worldbend-transport-schema-probe',
]) {
  const source = existsSync(path.join(stagedBinDir, name))
    ? path.join(stagedBinDir, name)
    : debugBinary(name)
  const destination = path.join(root, 'bin', name)
  copyFileSync(source, destination)
  chmodSync(destination, 0o755)
}

const manifest = load('capabilities/provider.json')
const implementation = manifest.implementations[0]
assert.equal(implementation.adapter.command, '../bin/worldbend-capability')
assert.deepEqual(implementation.adapter.args, [])
assert.equal(implementation.adapter.cwd, 'capabilities')
assert.equal(
  implementation.transportSchemaProbe.command,
  '../bin/worldbend-transport-schema-probe',
)
assert.deepEqual(implementation.transportSchemaProbe.args, [])
assert.equal(implementation.transportSchemaProbe.cwd, 'capabilities')
const bindings = new Map(
  implementation.bindings.map((binding) => [binding.operationId, binding]),
)
for (const operation of ['inspect', 'render']) {
  const binding = bindings.get(operation)
  assert.equal(
    binding.contractSchemaDigests.input,
    digest(load(`capabilities/schemas/projective.${operation}.input.schema.json`)),
  )
  assert.equal(
    binding.contractSchemaDigests.output,
    digest(load(`capabilities/schemas/projective.${operation}.output.schema.json`)),
  )
}

const suffix = process.platform === 'win32' ? '.exe' : ''
const adapter = path.join(root, 'bin', `worldbend-capability${suffix}`)
const identitySpec = {
  schema: 'projective.transform',
  version: '0.1',
  destination: {
    space: 'pixel',
    reference: { width: 10, height: 10 },
    quad: {
      tl: { x: 0, y: 0 },
      tr: { x: 10, y: 0 },
      br: { x: 10, y: 10 },
      bl: { x: 0, y: 10 },
    },
  },
  content: { fit: 'stretch' },
}

const inspected = callCapability('inspect', { spec: identitySpec }, root)
assert.equal(inspected.ok, true)
assert.equal(inspected.result.bounds.width, 10)
assert.deepEqual(inspected.result.geometry.edge_lengths, [10, 10, 10, 10])
validateAdapterOutput('inspect', inspected.result)

const invalid = callCapability('inspect', { spec: identitySpec, unknown: true }, root)
assert.equal(invalid.ok, false)
assert.equal(invalid.error.code, 'INVALID_INPUT')

const productOnlyOrientation = structuredClone(identitySpec)
productOnlyOrientation.content.orientation = 'flipHorizontal'
const orientationRejected = callCapability(
  'inspect',
  { spec: productOnlyOrientation },
  root,
)
assert.equal(orientationRejected.ok, false)
assert.equal(orientationRejected.error.code, 'INVALID_INPUT')

const productOnlyWarp = structuredClone(identitySpec)
productOnlyWarp.content.warp = { preset: 'arc', amount: 0.75 }
const warpRejected = callCapability(
  'inspect',
  { spec: productOnlyWarp },
  root,
)
assert.equal(warpRejected.ok, false)
assert.equal(warpRejected.error.code, 'INVALID_INPUT')

const missing = callCapability(
  'render',
  { source: 'missing.png', output: 'result.png', spec: identitySpec },
  root,
)
assert.equal(missing.ok, false)
assert.equal(missing.error.code, 'SOURCE_NOT_FOUND')

const renderRoot = mkdtempSync(path.join(tmpdir(), 'worldbend-capability-'))
writeFileSync(
  path.join(renderRoot, 'source.png'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
)
const dryRun = callCapability(
  'render',
  { source: 'source.png', output: 'result.png', spec: identitySpec, dry_run: true },
  renderRoot,
)
assert.equal(dryRun.ok, true)
assert.equal(dryRun.result.status, 'ok')
assert.equal(dryRun.result.dry_run, true)
validateAdapterOutput('render', dryRun.result)
assert.equal(existsSync(path.join(renderRoot, 'result.png')), false, 'dry-run must not publish')

const written = callCapability(
  'render',
  { source: 'source.png', output: 'result.png', spec: identitySpec },
  renderRoot,
)
assert.equal(written.ok, true, JSON.stringify(written.error))
assert.equal(written.result.dry_run, false)
assert.ok(written.result.bytes > 0)
validateAdapterOutput('render', written.result)
assert.equal(existsSync(path.join(renderRoot, 'result.png')), true, 'real render must publish')

const collision = callCapability(
  'render',
  { source: 'source.png', output: 'result.png', spec: identitySpec },
  renderRoot,
)
assert.equal(collision.ok, false)
assert.equal(collision.error.code, 'OUTPUT_EXISTS')
assert.ok(
  !collision.error.message.includes(renderRoot),
  'Capability error messages must not leak the resolved workspace root',
)

const overwritten = callCapability(
  'render',
  { source: 'source.png', output: 'result.png', spec: identitySpec, overwrite: true },
  renderRoot,
)
assert.equal(overwritten.ok, true, JSON.stringify(overwritten.error))
validateAdapterOutput('render', overwritten.result)

  const client = new Client(path.join(root, 'bin', `worldbend-mcp${suffix}`))
  try {
    await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'worldbend-capability-check', version: '1' },
    })
    client.notify('notifications/initialized', {})
    const response = await client.request('tools/list', {})
    const tools = new Map(response.result.tools.map((tool) => [tool.name, tool]))
    for (const operation of ['inspect', 'render']) {
      const binding = bindings.get(operation)
      assert.equal(
        binding.transportSchemaDigests.input,
        digest(tools.get(binding.target).inputSchema),
      )
    }
    // The live transport must survive a malformed inbound wire line: the
    // garbage line produces no response, and the next valid request on the
    // same connection still receives its full result. The tolerant client
    // also asserts the server never emits a malformed line of its own.
    client.sendRaw('{definitely not json\n')
    const afterGarbage = await client.request('tools/list', {})
    assert.equal(afterGarbage.result.tools.length, 8)
    assert.equal(client.invalidLines, 0)
  } finally {
    client.close()
  }

const probe = path.join(root, 'bin', `worldbend-transport-schema-probe${suffix}`)
const probed = spawnSync(probe, [], {
  cwd: path.join(root, 'capabilities'),
  env: { ...process.env, OPENADAM_PROVIDER_ROOT: root },
  input: `${JSON.stringify({
    id: 'transport-schema',
    capabilityId: implementation.capabilityId,
    capabilityVersion: implementation.capabilityVersion,
  })}\n`,
  encoding: 'utf8',
  timeout: 10_000,
})
assert.equal(probed.status, 0, probed.stderr)
const probeResponse = JSON.parse(probed.stdout)
assert.equal(probeResponse.ok, true)
for (const binding of probeResponse.bindings) {
  assert.equal(
    bindings.get(binding.operationId).transportSchemaDigests.input,
    digest(binding.inputSchema),
  )
}

console.log('PASS Worldbend Capability provider contract and live MCP schema drift')

function callCapability(operationId, input, workspaceRoot) {
  const completed = spawnSync(adapter, [], {
    cwd: root,
    env: { ...process.env, OPENADAM_CAPABILITY_WORKSPACE_ROOT: workspaceRoot },
    input: `${JSON.stringify({ id: 'check', operationId, input })}\n`,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(completed.status, 0, completed.stderr)
  const lines = completed.stdout.trim().split('\n')
  assert.equal(lines.length, 1, 'Capability adapter must return one JSONL response')
  return JSON.parse(lines[0])
}
