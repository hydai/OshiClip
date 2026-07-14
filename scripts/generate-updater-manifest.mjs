import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createUpdaterManifest({
  version,
  repository,
  tag,
  publishedAt,
  notes,
  macSignature,
  windowsSignature,
}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid updater version: ${version}`);
  }
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match v${version}.`);
  }
  if (!macSignature.trim() || !windowsSignature.trim()) {
    throw new Error("Updater signatures must not be empty.");
  }

  const macAsset = `OshiClip_${version}_macos-arm64.app.tar.gz`;
  const windowsAsset = `OshiClip_${version}_windows-x64-setup.exe`;
  const releaseBase = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;

  return {
    version,
    notes,
    pub_date: publishedAt,
    platforms: {
      "darwin-aarch64": {
        signature: macSignature.trim(),
        url: `${releaseBase}/${macAsset}`,
      },
      "windows-x86_64": {
        signature: windowsSignature.trim(),
        url: `${releaseBase}/${windowsAsset}`,
      },
    },
  };
}

async function main() {
  const assetDirectory = resolve(process.argv[2] ?? "release-assets");
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const version = packageJson.version;
  const repository = process.env.GITHUB_REPOSITORY;
  const tag = process.env.GITHUB_REF_NAME;

  if (!repository || !tag) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_REF_NAME are required.");
  }

  const macSignatureFile = `OshiClip_${version}_macos-arm64.app.tar.gz.sig`;
  const windowsSignatureFile = `OshiClip_${version}_windows-x64-setup.exe.sig`;
  const [macSignature, windowsSignature] = await Promise.all([
    readFile(resolve(assetDirectory, macSignatureFile), "utf8"),
    readFile(resolve(assetDirectory, windowsSignatureFile), "utf8"),
  ]);
  const manifest = createUpdaterManifest({
    version,
    repository,
    tag,
    publishedAt: new Date().toISOString(),
    notes:
      process.env.UPDATER_NOTES ??
      `OshiClip ${tag} 已推出，完整變更請參閱 GitHub Release。`,
    macSignature,
    windowsSignature,
  });

  await writeFile(
    resolve(assetDirectory, "latest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`Generated updater manifest for OshiClip ${version}.`);
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entryPoint === import.meta.url) {
  await main();
}
