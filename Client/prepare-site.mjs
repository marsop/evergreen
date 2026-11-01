import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

export const assetHash = bytes => "sha256-" + createHash("sha256").update(bytes).digest("base64");

async function writePublishedFile(file, content) {
    await fs.writeFile(file, content);
    for (const [extension, compress] of [[".br", brotliCompressSync], [".gz", gzipSync]]) {
        try {
            await fs.access(file + extension);
        } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
        }
        await fs.writeFile(file + extension, compress(Buffer.from(content)));
    }
}

export async function prepareSite(root, basePath) {
    if (!/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(basePath)) {
        throw new Error("The site base path must be / or slash-delimited URL path segments.");
    }
    const indexPath = path.join(root, "index.html");
    const original = await fs.readFile(indexPath, "utf8");
    if (!/<base href="[^"]*" \/>/.test(original)) throw new Error("Missing entry-page base element.");
    const index = original.replace(/<base href="[^"]*" \/>/, `<base href="${basePath}" />`);
    const manifestPath = path.join(root, "service-worker-assets.js");
    const source = await fs.readFile(manifestPath, "utf8");
    const match = source.match(/self\.assetsManifest\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (!match) throw new Error("Invalid generated service-worker asset manifest.");
    const manifest = JSON.parse(match[1]);
    const entry = manifest.assets.find(asset => asset.url === "index.html");
    if (!entry) throw new Error("The offline asset manifest must contain index.html.");
    entry.hash = assetHash(index);
    manifest.version = createHash("sha256").update(JSON.stringify(manifest.assets)).digest("hex");
    await writePublishedFile(indexPath, index);
    await fs.writeFile(path.join(root, "404.html"), index);
    await writePublishedFile(manifestPath, "self.assetsManifest = " + JSON.stringify(manifest, null, 2) + ";\n");
    await fs.writeFile(path.join(root, ".nojekyll"), "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const [root, basePath] = process.argv.slice(2);
    if (!root || !basePath) throw new Error("Usage: node Client/prepare-site.mjs <published-wwwroot> <base-path>");
    await prepareSite(path.resolve(root), basePath);
}
