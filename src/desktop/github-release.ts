import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export const UPDATE_REPOSITORY = "TobeALeg/worket";
export type FetchRelease = (url: string, init?: RequestInit) => Promise<Response>;
type Asset = { name: string; browser_download_url: string; size: number };
export type Release = { version: string; archive: Asset; checksum: Asset };
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function isNewer(version: string, current: string): boolean {
  if (!stable.test(version) || !stable.test(current)) return false;
  const left = version.split(".").map(BigInt);
  const right = current.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i]! > right[i]!;
  }
  return false;
}
function assetUrl(asset: Asset): string {
  const url = new URL(asset.browser_download_url);
  if (url.origin !== "https://github.com" ||
      !url.pathname.startsWith(`/${UPDATE_REPOSITORY}/releases/download/`))
    throw new Error("更新附件地址不属于 Worket 发布仓库");
  return url.href;
}
export async function latestRelease(
  fetcher: FetchRelease,
  current: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<Release | null> {
  const response = await fetcher(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Worket" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub 检查失败（${response.status}），请稍后重试`);
  const data = await response.json() as { tag_name: string; draft: boolean; prerelease: boolean; assets: Asset[] };
  const version = data.tag_name.replace(/^v/, "");
  if (data.draft || data.prerelease || !isNewer(version, current)) return null;
  if (platform !== "darwin" && platform !== "win32") return null;
  const name = `Worket-${version}-${platform}-${arch}.zip`;
  const archive = data.assets.find(asset => asset.name === name);
  const checksum = data.assets.find(asset => asset.name === `${name}.sha256`);
  if (!archive || !checksum) throw new Error("新版缺少本机架构的安装包或校验文件，请等待发布者补齐");
  assetUrl(archive); assetUrl(checksum);
  return { version, archive, checksum };
}

/** Save only complete, checksum-verified archives; never extract or execute updates. */
export async function downloadRelease(fetcher: FetchRelease, release: Release, downloads: string): Promise<string> {
  const signal = AbortSignal.timeout(20 * 60 * 1000);
  const checksumResponse = await fetcher(assetUrl(release.checksum), { signal });
  if (!checksumResponse.ok) throw new Error("无法下载校验文件");
  const checksum = (await checksumResponse.text()).trim();
  const match = /^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)$/.exec(checksum);
  if (!match || match[2] !== release.archive.name) throw new Error("校验文件格式不正确");
  if (!Number.isSafeInteger(release.archive.size) || release.archive.size <= 0 || release.archive.size > 2 * 1024 ** 3)
    throw new Error("安装包大小不正确");
  await mkdir(downloads, { recursive: true });
  const directory = await mkdtemp(join(downloads, "Worket-update-"));
  const target = join(directory, release.archive.name);
  try {
    const response = await fetcher(assetUrl(release.archive), { signal });
    if (!response.ok || !response.body) throw new Error("安装包下载失败");
    const file = await open(`${target}.part`, "wx");
    const hash = createHash("sha256");
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > release.archive.size) throw new Error("安装包大小与发布信息不一致");
        hash.update(chunk);
        await file.writeFile(chunk);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await file.close();
    }
    if (size !== release.archive.size || hash.digest("hex") !== match[1]!.toLowerCase())
      throw new Error("安装包校验失败，请重新下载");
    await rename(`${target}.part`, target);
    return target;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
