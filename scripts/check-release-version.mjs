import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const tauriConfig = JSON.parse(
  await readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"),
);
const releaseConfig = JSON.parse(
  await readFile(
    new URL("src-tauri/tauri.release.conf.json", root),
    "utf8",
  ),
);
const cargoToml = await readFile(
  new URL("src-tauri/Cargo.toml", root),
  "utf8",
);
const cargoPackage = cargoToml.match(
  /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
);

if (!cargoPackage) {
  throw new Error("Could not read [package].version from src-tauri/Cargo.toml.");
}

const versions = new Map([
  ["package.json", packageJson.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  ["src-tauri/Cargo.toml", cargoPackage[1]],
]);
const expectedVersion = packageJson.version;
const mismatches = [...versions].filter(
  ([, version]) => version !== expectedVersion,
);

if (mismatches.length > 0) {
  const details = [...versions]
    .map(([file, version]) => `${file}: ${version}`)
    .join("\n");
  throw new Error(`Application versions do not match:\n${details}`);
}

const updater = tauriConfig.plugins?.updater;
if (
  typeof updater?.pubkey !== "string" ||
  updater.pubkey.length < 32 ||
  !updater.endpoints?.includes(
    "https://github.com/hydai/OshiClip/releases/latest/download/latest.json",
  )
) {
  throw new Error("Tauri GitHub updater configuration is incomplete.");
}

if (releaseConfig.bundle?.createUpdaterArtifacts !== true) {
  throw new Error(
    "src-tauri/tauri.release.conf.json must create signed updater artifacts.",
  );
}

if (process.env.GITHUB_REF_TYPE === "tag") {
  const expectedTag = `v${expectedVersion}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    throw new Error(
      `Release tag ${process.env.GITHUB_REF_NAME} does not match ${expectedTag}.`,
    );
  }
}

console.log(`Verified OshiClip version ${expectedVersion}.`);
