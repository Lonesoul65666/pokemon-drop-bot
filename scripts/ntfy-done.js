const fs = require('fs');
const path = require('path');

function readEnvTopicFromDisk() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const m = trimmed.match(/^NTFY_TOPIC\s*=\s*(.*)$/);
        if (m) {
          const val = m[1].trim().replace(/^['"]|['"]$/g, '');
          if (val) return val;
        }
      }
    }
  } catch {}
  return String(process.env.NTFY_TOPIC || '').trim();
}

const hardGuard = setTimeout(() => {
  process.exit(0);
}, 5500);
if (hardGuard.unref) hardGuard.unref();

(async () => {
  try {
    const topic = readEnvTopicFromDisk();
    if (!topic) {
      console.warn('[ntfy-done] NTFY_TOPIC not set in .env — skipping ping.');
      return;
    }
    const summary = process.argv.slice(2).join(' ').trim() || 'DropBot CLI task complete.';
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: '[DropBot CLI] Task Complete',
        Tags: 'robot'
      },
      body: summary,
      signal: AbortSignal.timeout(5000)
    });
    await res.text().catch(() => '');
    console.log(`[ntfy-done] Dispatched completion ping to ${topic} (HTTP ${res.status}).`);
  } catch (err) {
    console.warn(`[ntfy-done] Ping warning: ${err && err.message ? err.message : err}`);
  } finally {
    setTimeout(() => process.exit(0), 60);
  }
})();
