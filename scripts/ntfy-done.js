const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

setTimeout(() => {
  process.exit(0);
}, 4500).unref();

(async () => {
  try {
    const topic = String(process.env.NTFY_TOPIC || '').trim();
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
      signal: AbortSignal.timeout(4000)
    });
    await res.body?.cancel().catch(() => {});
    console.log(`[ntfy-done] Dispatched completion ping (HTTP ${res.status}).`);
  } catch (err) {
    console.warn(`[ntfy-done] Ping warning: ${err && err.message ? err.message : err}`);
  } finally {
    process.exit(0);
  }
})();
