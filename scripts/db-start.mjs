// Starts the project-local MongoDB replica set (port 27018, data in
// .mongo/data) and, once it accepts connections, initiates `rs0` if that has
// not been done yet — so a fresh checkout is one command away from a working
// database on Windows, Linux and macOS alike.
//
// `mongod` is found on PATH first; otherwise the platform's usual install
// location is tried. Set MONGOD=/path/to/mongod to override both.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 27018
const REPLICA_SET = 'rs0'
const DATA_DIR = join('.mongo', 'data')
const MONGOD_ARGS = ['--replSet', REPLICA_SET, '--port', String(PORT), '--bind_ip', '127.0.0.1', '--dbpath', DATA_DIR]
const READY_TIMEOUT_MS = 30_000
const READY_POLL_MS = 500

const IS_WINDOWS = process.platform === 'win32'
const BINARY_NAME = IS_WINDOWS ? 'mongod.exe' : 'mongod'
const SHELL_NAME = IS_WINDOWS ? 'mongosh.exe' : 'mongosh'

/** Where the vendor installer puts mongod when it is not on PATH. */
const INSTALL_HINTS = {
  win32: { dirs: () => versionedBinDirs('C:\\Program Files\\MongoDB\\Server'), install: 'Install MongoDB Community Server 8 from mongodb.com/try/download/community' },
  linux: { dirs: () => ['/usr/bin', '/usr/local/bin', '/snap/bin'], install: 'Install the mongodb-org package: https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/' },
  darwin: { dirs: () => ['/opt/homebrew/bin', '/usr/local/bin'], install: 'brew tap mongodb/brew && brew install mongodb-community@8' },
}

/** C:\Program Files\MongoDB\Server\<version>\bin, newest version first. */
function versionedBinDirs(root) {
  if (!existsSync(root)) return []
  return readdirSync(root).sort().reverse().map((version) => join(root, version, 'bin'))
}

function isOnPath(name) {
  const probe = IS_WINDOWS ? 'where' : 'which'
  return spawnSync(probe, [name], { stdio: 'ignore' }).status === 0
}

function findBinary(name) {
  if (process.env.MONGOD && name === BINARY_NAME) return process.env.MONGOD
  if (isOnPath(name)) return name
  const hint = INSTALL_HINTS[process.platform]
  for (const dir of hint?.dirs() ?? []) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Polls mongod until it answers a ping, or gives up. */
async function waitForMongod(mongosh) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ping = spawnSync(mongosh, ['--quiet', '--port', String(PORT), '--eval', 'db.adminCommand({ ping: 1 }).ok'], { encoding: 'utf8' })
    if (ping.status === 0 && ping.stdout.includes('1')) return true
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
  }
  return false
}

/** rs.initiate() is a no-op error once the set exists; only a first run does anything. */
function initiateReplicaSet(mongosh) {
  const script = `
    try {
      rs.initiate({ _id: '${REPLICA_SET}', members: [{ _id: 0, host: '127.0.0.1:${PORT}' }] })
      print('replica set ${REPLICA_SET} initiated')
    } catch (error) {
      if (!/already initialized/i.test(String(error))) throw error
      print('replica set ${REPLICA_SET} already initialized')
    }`
  const result = spawnSync(mongosh, ['--quiet', '--port', String(PORT), '--eval', script], { encoding: 'utf8' })
  console.log(result.stdout.trim() || result.stderr.trim())
}

const mongod = findBinary(BINARY_NAME)
if (!mongod) {
  const hint = INSTALL_HINTS[process.platform]
  console.error(`mongod not found on PATH${hint ? ` or in ${hint.dirs().join(', ') || 'the usual install location'}` : ''}.`)
  console.error(hint?.install ?? 'Install MongoDB Community Server 8 and put mongod on PATH, or set MONGOD=/path/to/mongod.')
  process.exit(1)
}

mkdirSync(DATA_DIR, { recursive: true })
console.log(`Starting ${mongod} on 127.0.0.1:${PORT} (replica set ${REPLICA_SET}, data in ${DATA_DIR})...`)
const child = spawn(mongod, MONGOD_ARGS, { stdio: 'inherit' })
child.on('error', (error) => {
  console.error(`Could not start mongod: ${error.message}`)
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 1))

const mongosh = findBinary(SHELL_NAME)
if (!mongosh) {
  console.log(`mongosh not found, so the replica set was not initiated automatically. Once, run:\n  mongosh --port ${PORT} --eval "rs.initiate({ _id: '${REPLICA_SET}', members: [{ _id: 0, host: '127.0.0.1:${PORT}' }] })"`)
} else if (await waitForMongod(mongosh)) {
  initiateReplicaSet(mongosh)
} else {
  console.error(`mongod did not answer on port ${PORT} within ${READY_TIMEOUT_MS / 1000}s; check the log above.`)
}
