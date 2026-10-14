import axios from 'axios';
import fs from 'fs';
import path from 'path';

const ART_DIR = path.resolve(process.cwd(), 'art');

if (!fs.existsSync(ART_DIR)) {
  fs.mkdirSync(ART_DIR, { recursive: true });
}

const ART_MAP: Record<string, string> = {
  "mega-pitch-black-case": "https://images.pokemontcg.io/me05/logo.png",
  "mega-pitch-black-etb-case": "https://images.pokemontcg.io/me05/logo.png",
  "mega-pitch-black-bb": "https://images.pokemontcg.io/me05/logo.png",
  "mega-pitch-black-etb": "https://images.pokemontcg.io/me05/logo.png",
  "mega-pitch-black-bundle": "https://images.pokemontcg.io/me05/logo.png",
  "mega-chaos-rising-case": "https://images.pokemontcg.io/me04/logo.png",
  "mega-chaos-rising-bb": "https://images.pokemontcg.io/me04/logo.png",
  "mega-chaos-rising-etb": "https://images.pokemontcg.io/me04/logo.png",
  "mega-perfect-order-bb": "https://images.pokemontcg.io/me03/logo.png",
  "mega-phantasmal-flames-bb": "https://images.pokemontcg.io/me02/logo.png",
  "30th-celebration-etb-case": "https://images.pokemontcg.io/me06/logo.png",
  "30th-celebration-etb": "https://images.pokemontcg.io/me06/logo.png",
  "30th-celebration-bundle": "https://images.pokemontcg.io/me06/logo.png",
  "sv-prismatic-evolutions-etb": "https://images.pokemontcg.io/sv8pt5/logo.png",
  "sv-prismatic-evolutions-bundle": "https://images.pokemontcg.io/sv8pt5/logo.png",
  "sv-151-etb": "https://images.pokemontcg.io/sv3pt5/logo.png",
  "sv-151-bundle": "https://images.pokemontcg.io/sv3pt5/logo.png",
  "sv-151-upc": "https://images.pokemontcg.io/sv3pt5/logo.png",
  "swsh-evolving-skies-bb": "https://images.pokemontcg.io/swsh7/logo.png",
  "swsh-crown-zenith-etb": "https://images.pokemontcg.io/swsh12pt5/logo.png"
};

async function downloadImage(id: string, url: string) {
  const filePath = path.join(ART_DIR, `${id}.jpg`);
  if (fs.existsSync(filePath)) {
    console.log(`[SKIP] Art already exists for ${id}`);
    return;
  }
  try {
    const response = await axios({ url, responseType: 'stream' });
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      writer.on('finish', () => {
        console.log(`[SUCCESS] Downloaded art for ${id}`);
        resolve(true);
      });
      writer.on('error', reject);
    });
  } catch (err: any) {
    console.error(`[ERROR] Failed to download art for ${id}: ${err.message}`);
  }
}

async function run() {
  console.log("Executing Auto-Art Ingestion...");
  for (const [id, url] of Object.entries(ART_MAP)) {
    await downloadImage(id, url);
  }
  console.log("Art ingestion complete.");
}

run();