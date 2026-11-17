import { ACTIONS } from './actions';

/**
 * Container tooling shared by both providers' pipelines.
 *
 * Both providers publish images the same way: the unprivileged build runs `build:container-plan`
 * and `build:docker` (`docker build` on GitHub runners and laptops; on GitLab, kaniko-build.sh on
 * the kaniko image, as those runners allow no Docker daemon) into `assets/containers/<hash>.tar.gz`, which rides in
 * `dist/content.zip`; `build:image-tags` then tags each image by its asset hash and installed OS
 * packages; the privileged deploy pushes those tarballs with crane from `deploy:docker`
 * (inside `deploy:upload`). The deploy never builds an image, so it never runs a Dockerfile
 * from a PR.
 */

/** crane version pinned for reproducible daemonless ECR pushes. */
export const CRANE_VERSION = 'v0.22.1';

/** Download URL of crane for the runner's architecture (`$arch` = x86_64 | arm64, the release's asset names). */
const CRANE_URL = `https://github.com/google/go-containerregistry/releases/download/${CRANE_VERSION}/go-containerregistry_Linux_\${arch}.tar.gz`;

/**
 * SHA-256 of each release asset (the release's checksums.txt, checked against a download). crane
 * runs in the job that holds the deploy credentials, so an asset that isn't this one never runs
 * (review 10b D6). A CRANE_VERSION bump needs these updated with it.
 */
export const CRANE_SHA256: Readonly<Record<string, string>> = {
  x86_64: '0ab7a1d6932a213aed964ce97666c3077fe691c8606413674a8b3e0b9ec4cda0',
  arm64: '898c0cff975f898a33e8c4580bdafb0e7c02c7faa33374e946762f97c4ab7110',
};

/**
 * curl's retries for a download from GitHub releases: a 504 from GitHub failed two projects' weekly
 * runs in one morning. `--retry-all-errors` retries an HTTP error too (plain `--retry` only
 * retries a timeout or a 408/429/5xx it can see before the body, and never a refused connection).
 */
export const CURL_RETRY_FLAGS = '--retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 10';
export const CURL_RETRY = `${CURL_RETRY_FLAGS} --max-time 300`;

/**
 * {@link CURL_RETRY} with another cap per attempt, for a large file: 300 s fails a 60 MB download
 * below about 200 KB/s. `curlRetry(1800)`.
 */
export function curlRetry(maxTimeSeconds: number): string {
  if (!Number.isInteger(maxTimeSeconds) || maxTimeSeconds <= 0) throw new Error(`curlRetry: ${maxTimeSeconds} is not a whole number of seconds`);
  return `${CURL_RETRY_FLAGS} --max-time ${maxTimeSeconds}`;
}

/**
 * Shell that installs crane into `dir` (which must already be on PATH, or be added after).
 *
 * One line, ending in `|| exit 1`: a shell with errexit ignores a failure inside an `a && b` list,
 * so without it a failed download let the GitLab job run its next line and stop later at
 * "crane not found on PATH".
 */
export function craneInstall(dir: string): string {
  return [
    // The release names its assets x86_64 and arm64 (amd64 404s): only aarch64 needs renaming.
    'arch=$(uname -m | sed "s/aarch64/arm64/");',
    `case "$arch" in x86_64) sum=${CRANE_SHA256.x86_64} ;; arm64) sum=${CRANE_SHA256.arm64} ;; *) echo "crane: no pinned checksum for $arch" >&2; exit 1 ;; esac;`,
    `{ mkdir -p "${dir}" &&`,
    `curl -fsSL ${CURL_RETRY} -o "${dir}/crane.tar.gz" "${CRANE_URL}" &&`,
    `echo "$sum  ${dir}/crane.tar.gz" | sha256sum -c - &&`,
    `tar -xzf "${dir}/crane.tar.gz" -C "${dir}" crane && rm -f "${dir}/crane.tar.gz"`,
    `&& "${dir}/crane" version; } || { echo "crane: install failed (see the error above)" >&2; exit 1; }`,
  ].join(' ');
}

/**
 * GitHub step registering QEMU binfmt handlers before a build that makes images, so `docker build
 * --platform` can run a Dockerfile's RUN steps for the other architecture: the PR build and the
 * deploy's build job run on arm64 runners, so an X86_64 image needs emulation there.
 */
export const GITHUB_QEMU_STEP = { name: 'Set up QEMU (cross-arch image builds)', uses: ACTIONS.setupQemu };
