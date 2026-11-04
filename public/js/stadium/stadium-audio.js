/* =========================================================================
 * LOGAN'S BATTLE STADIUM — AUDIO & CRY SYNTHESIZER (stadium-audio.js)
 * WebAudio API Battle Synthesizer + Official PokeAPI Cry Audio Player.
 * Hard-Frozen in V5 Slice 2.
 * ========================================================================= */
function playPokemonCry(id) {
  if (!partnerState.cryAudio) return;
  try {
    const audio = new Audio('https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/' + id + '.ogg');
    audio.volume = 0.35;
    audio.play().catch(() => {});
  } catch (e) {}
}

// Web Audio API Arcade Battle Synth SFX (Whoosh + Impact + Super Effective + Heal + Catch Click + Victory)
let __battleAudioCtx = null;
function playBattleSynthSfx(kind) {
  if (!partnerState.cryAudio) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!__battleAudioCtx) __battleAudioCtx = new AudioCtx();
    if (__battleAudioCtx.state === 'suspended') __battleAudioCtx.resume();
    const now = __battleAudioCtx.currentTime;

    if (kind === 'whoosh') {
      const osc = __battleAudioCtx.createOscillator();
      const gain = __battleAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.22);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(__battleAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.23);
    } else if (kind === 'impact') {
      const osc = __battleAudioCtx.createOscillator();
      const gain = __battleAudioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.28);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(__battleAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.29);
    } else if (kind === 'super_effective') {
      [220, 440, 880].forEach((freq, i) => {
        const osc = __battleAudioCtx.createOscillator();
        const gain = __battleAudioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.05);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.4, now + i * 0.05 + 0.18);
        gain.gain.setValueAtTime(0.16, now + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.18);
        osc.connect(gain);
        gain.connect(__battleAudioCtx.destination);
        osc.start(now + i * 0.05);
        osc.stop(now + i * 0.05 + 0.19);
      });
    } else if (kind === 'heal') {
      [587.33, 783.99, 1174.66].forEach((freq, i) => {
        const osc = __battleAudioCtx.createOscillator();
        const gain = __battleAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        gain.gain.setValueAtTime(0.16, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.22);
        osc.connect(gain);
        gain.connect(__battleAudioCtx.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.23);
      });
    } else if (kind === 'catch_click') {
      const osc = __battleAudioCtx.createOscillator();
      const gain = __battleAudioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.exponentialRampToValueAtTime(980, now + 0.08);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(__battleAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.10);
    } else if (kind === 'victory') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = __battleAudioCtx.createOscillator();
        const gain = __battleAudioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.09);
        gain.gain.setValueAtTime(0.18, now + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.28);
        osc.connect(gain);
        gain.connect(__battleAudioCtx.destination);
        osc.start(now + i * 0.09);
        osc.stop(now + i * 0.09 + 0.29);
      });
    }
  } catch (e) {}
}

function toggleStadiumSound(ev) {
  if (ev) ev.stopPropagation();
  partnerState.cryAudio = !partnerState.cryAudio;
  savePartnerStateToStorage();
  renderStadiumCombatUI();
  applyPartnerThemeAndHeader();
}

function toggleCryAudio() {
  partnerState.cryAudio = !partnerState.cryAudio;
  applyPartnerThemeAndHeader();
  if (partnerState.cryAudio) playPokemonCry(partnerState.slot1.id);
  showCommanderToast(partnerState.cryAudio ? 'Pokédex Cry Audio: ON' : 'Pokédex Cry Audio: OFF');
}

