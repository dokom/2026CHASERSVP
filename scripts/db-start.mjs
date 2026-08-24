// Starts the project-local MongoDB replica set (port 27018, data in .mongo/data).
// `mongod` is usually not on PATH on Windows, so fall back to the default
// MongoDB Server install location before giving up.
import { spawnSync, spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MONGO_ARGS = ["--replSet", "rs0", "--port", "27018", "--bind_ip", "127.0.0.1", "--dbpath", ".mongo/data"];
const WINDOWS_INSTALL_ROOT = "C:/Program Files/MongoDB/Server";

function isOnPath() {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, ["mongod"], { stdio: "ignore" }).status === 0;
}

function findWindowsInstall() {
  if (!existsSync(WINDOWS_INSTALL_ROOT)) return null;
  const versions = readdirSync(WINDOWS_INSTALL_ROOT).sort().reverse();
  for (const version of versions) {
    const candidate = join(WINDOWS_INSTALL_ROOT, version, "bin", "mongod.exe");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const binary = isOnPath() ? "mongod" : findWindowsInstall();
if (!binary) {
  console.error(`mongod not found on PATH or under ${WINDOWS_INSTALL_ROOT}. Install MongoDB Community Server 8.`);
  process.exit(1);
}

mkdirSync(".mongo/data", { recursive: true });
console.log(`Starting ${binary} on 127.0.0.1:27018 (replica set rs0)...`);
const child = spawn(binary, MONGO_ARGS, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
