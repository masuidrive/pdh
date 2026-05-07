// Screenshot optimisation for Epic verification artifacts.
//
// Decodes PNG / JPEG / WebP, optionally resizes to a max long side,
// and re-encodes as WebP. Uses jSquash (WASM) so there's no native
// build dependency at install time.
//
// Node 24's built-in fetch (undici) doesn't handle file:// URLs, but
// jSquash's emscripten loaders use fetch to grab the .wasm files. We
// install a tiny shim that returns the file bytes with the right
// Content-Type so emscripten's streaming-instantiate path works.
//
// The shim is installed lazily on first use, scoped to file:// URLs,
// and falls back to the original fetch for everything else.
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
let fetchShimInstalled = false;
function installFileFetchShim() {
    if (fetchShimInstalled)
        return;
    fetchShimInstalled = true;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
        const url = typeof input === "string" ? input : input?.url ?? String(input);
        if (url.startsWith("file://")) {
            const path = fileURLToPath(url);
            const body = readFileSync(path);
            return new Response(body, { status: 200, headers: { "content-type": "application/wasm" } });
        }
        return originalFetch(input, init);
    });
}
function toArrayBuffer(buf) {
    // Node Buffers can share an ArrayBuffer with siblings; slice to get a
    // standalone ArrayBuffer view that satisfies the BufferSource APIs.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
async function decodeImage(srcPath) {
    const ext = srcPath.toLowerCase().slice(srcPath.lastIndexOf("."));
    const bytes = toArrayBuffer(readFileSync(srcPath));
    installFileFetchShim();
    if (ext === ".png") {
        const mod = await import("@jsquash/png/decode.js");
        return mod.default(bytes);
    }
    if (ext === ".jpg" || ext === ".jpeg") {
        const mod = await import("@jsquash/jpeg/decode.js");
        return mod.default(bytes);
    }
    if (ext === ".webp") {
        const mod = await import("@jsquash/webp/decode.js");
        return mod.default(bytes);
    }
    throw new Error(`Unsupported screenshot format: ${ext} (${srcPath})`);
}
async function resizeIfNeeded(image, maxSide) {
    const longest = Math.max(image.width, image.height);
    if (longest <= maxSide)
        return image;
    installFileFetchShim();
    const scale = maxSide / longest;
    const targetWidth = Math.max(1, Math.round(image.width * scale));
    const targetHeight = Math.max(1, Math.round(image.height * scale));
    const mod = await import("@jsquash/resize");
    const resized = await mod.default(image, { width: targetWidth, height: targetHeight });
    return resized;
}
async function encodeWebp(image, quality) {
    installFileFetchShim();
    const mod = await import("@jsquash/webp/encode.js");
    const buf = await mod.default(image, { quality });
    return new Uint8Array(buf);
}
export async function optimizeScreenshot(srcPath, destPath, options = {}) {
    const quality = options.quality ?? 80;
    const maxSide = options.maxSide ?? 1280;
    const decoded = await decodeImage(srcPath);
    const resized = await resizeIfNeeded(decoded, maxSide);
    const encoded = await encodeWebp(resized, quality);
    writeFileSync(destPath, encoded);
    return {
        srcBytes: statSync(srcPath).size,
        destBytes: encoded.byteLength,
        width: resized.width,
        height: resized.height
    };
}
const SOURCE_EXTS = new Set([".png", ".jpg", ".jpeg"]);
export async function optimizeScreenshotsInDir(dir, options = {}) {
    const result = {
        converted: [], skipped: [], failed: []
    };
    if (!existsSync(dir))
        return result;
    const log = options.logger ?? (() => { });
    const deleteOriginals = options.deleteOriginals ?? true;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile())
            continue;
        const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
        if (!SOURCE_EXTS.has(ext)) {
            result.skipped.push(entry.name);
            continue;
        }
        const src = join(dir, entry.name);
        const stem = entry.name.slice(0, entry.name.lastIndexOf("."));
        const dest = join(dir, `${stem}.webp`);
        try {
            const stats = await optimizeScreenshot(src, dest, options);
            log(`screenshot: ${entry.name} → ${stem}.webp (${stats.srcBytes} → ${stats.destBytes} bytes, ${stats.width}x${stats.height})`);
            if (deleteOriginals) {
                unlinkSync(src);
            }
            result.converted.push(dest);
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            log(`screenshot: failed ${entry.name}: ${reason}`);
            result.failed.push({ path: src, reason });
        }
    }
    return result;
}
