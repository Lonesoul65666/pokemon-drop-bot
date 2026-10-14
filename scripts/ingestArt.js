"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const policies_1 = require("../policies");
const ART_DIR = path_1.default.resolve(process.cwd(), 'dashboard', 'public', 'art');
async function downloadArt(setSlug, format, url) {
    const targetPath = path_1.default.join(ART_DIR, `${setSlug}-${format}.webp`);
    if (await fs_extra_1.default.pathExists(targetPath))
        return;
    try {
        const res = await axios_1.default.get(url, { responseType: 'arraybuffer', timeout: 8000 });
        await fs_extra_1.default.writeFile(targetPath, res.data);
        console.log(`[ArtIngest] Downloaded: ${setSlug}-${format}.webp`);
    }
    catch (err) {
        console.warn(`[ArtIngest] Remote fetch failed for ${setSlug}-${format}, generating SVG fallback.`);
        const fallbackSvg = `
<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#18181b" rx="16"/>
  <rect x="20" y="20" width="560" height="560" fill="none" stroke="#27272a" stroke-width="2" rx="12"/>
  <text x="50%" y="46%" text-anchor="middle" fill="#f43f5e" font-family="sans-serif" font-weight="700" font-size="32">${setSlug.toUpperCase()}</text>
  <text x="50%" y="54%" text-anchor="middle" fill="#a1a1aa" font-family="sans-serif" font-weight="600" font-size="20">${format.replace(/_/g, ' ').toUpperCase()}</text>
</svg>`.trim();
        await fs_extra_1.default.writeFile(path_1.default.join(ART_DIR, `${setSlug}-${format}.svg`), fallbackSvg);
    }
}
async function run() {
    await fs_extra_1.default.ensureDir(ART_DIR);
    console.log('[ArtIngest] Pre-warming sealed assets...');
    for (const policy of policies_1.WATCH_POLICIES) {
        if (!policy.active)
            continue;
        const format = policy.formFactor || 'etb';
        const slug = policy.id.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        // Defaulting to Pokemon TCG Developer API image paths if no direct URL is provided
        const sourceUrl = policy.image || `https://images.pokemontcg.io/${slug}/logo.png`;
        await downloadArt(slug, format, sourceUrl);
    }
    console.log('[ArtIngest] Pre-warm sequence complete.');
}
run();
