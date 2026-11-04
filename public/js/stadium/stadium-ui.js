/* =========================================================================
 * LOGAN'S BATTLE STADIUM — ARENA UI, DRAWERS & ENTRYPOINTS (stadium-ui.js)
 * Arena DOM Rendering, 4 Visual Attack Animations, Trophy Vault Drawer,
 * Squad & Deck Builder Drawer, and Global window.* Entrypoints.
 * Hard-Frozen in V5 Slice 2.
 * ========================================================================= */
function showArcadeCombatCallout(text, styleType) {
  const wrap = document.getElementById('stadiumArcadeCalloutBanner');
  const inner = document.getElementById('stadiumArcadeCalloutInner');
  if (!wrap || !inner) return;
  inner.innerText = text;
  if (styleType === 'CRIT') {
    inner.className = 'px-6 py-2 rounded-2xl border-2 border-rose-400 bg-[#090812]/95 text-rose-300 font-black italic uppercase tracking-wider text-xl sm:text-2xl shadow-[0_0_55px_rgba(244,63,94,0.95)] whitespace-nowrap';
  } else if (styleType === 'RESIST') {
    inner.className = 'px-6 py-2 rounded-2xl border-2 border-slate-400 bg-[#090812]/95 text-slate-200 font-black italic uppercase tracking-wider text-lg sm:text-xl shadow-[0_0_30px_rgba(148,163,184,0.6)] whitespace-nowrap';
  } else if (styleType === 'SHINY' || styleType === 'OVERDRIVE') {
    inner.className = 'px-6 py-2 rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-[#1A103C]/95 via-[#090812]/95 to-[#1A103C]/95 text-amber-200 font-black italic uppercase tracking-wider text-xl sm:text-2xl shadow-[0_0_65px_rgba(250,204,21,0.95)] whitespace-nowrap';
  } else {
    inner.className = 'px-6 py-2 rounded-2xl border-2 border-emerald-300 bg-[#090812]/95 text-emerald-300 font-black italic uppercase tracking-wider text-xl sm:text-2xl shadow-[0_0_55px_rgba(16,185,129,0.9)] whitespace-nowrap';
  }
  wrap.classList.remove('opacity-0', 'scale-75');
  wrap.classList.add('opacity-100', 'scale-105');
  clearTimeout(window.__arcadeCalloutTimer);
  window.__arcadeCalloutTimer = setTimeout(() => {
    wrap.classList.remove('opacity-100', 'scale-105');
    wrap.classList.add('opacity-0', 'scale-75');
  }, 1250);
}

function showCommanderToast(msg) {
  const el = document.getElementById('evoToast');
  const txt = document.getElementById('evoToastText');
  if (!el || !txt) return;
  txt.innerText = msg;
  el.classList.remove('opacity-0', 'translate-y-2');
  el.classList.add('opacity-100', 'translate-y-0');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.classList.remove('opacity-100', 'translate-y-0');
    el.classList.add('opacity-0', 'translate-y-2');
  }, 3200);
}

function pulseScreenClashAura() {
  document.body.classList.remove('aura-clash-pulse');
  void document.body.offsetWidth;
  document.body.classList.add('aura-clash-pulse');
}

function renderSquadHudForSide(sideNum) {
  const container = document.getElementById('stadiumPartyHud' + sideNum);
  if (!container) return;
  const team = sideNum === 1 ? stadiumBattleState.team1 : stadiumBattleState.team2;
  const activeIdx = sideNum === 1 ? (stadiumBattleState.activeIdx1 || 0) : (stadiumBattleState.activeIdx2 || 0);
  if (!Array.isArray(team)) return;

  container.innerHTML = team.map((m, idx) => {
    const isAct = idx === activeIdx;
    const isFainted = m.hp <= 0;
    const hpPct = Math.max(0, Math.min(100, Math.round((m.hp / Math.max(1, m.maxHp)) * 100)));
    const hpColor = hpPct === 0 ? 'bg-rose-600' : (hpPct < 25 ? 'bg-rose-500' : (hpPct < 55 ? 'bg-amber-400' : 'bg-emerald-400'));
    const pillCls = isAct ? 'squad-slot-active' : (isFainted ? 'squad-slot-fainted' : '');
    const ballColor = isFainted ? '#64748B' : (isAct ? '#00F0FF' : '#10B981');
    const statusTag = m.ailment && STATUS_BADGE_STYLES[m.ailment]
      ? '<span class="px-1 rounded text-[8px] font-mono-num font-black ' + STATUS_BADGE_STYLES[m.ailment].cls + '">' + m.ailment + '</span>'
      : (m.megaActive ? '<span class="px-1 rounded text-[8px] font-mono-num font-black bg-amber-400 text-slate-950">MEGA</span>' : '<span class="text-[8px] font-mono-num text-slate-400">S' + (idx + 1) + '</span>');

    return (
      '<button onclick="switchSquadMember(' + sideNum + ', ' + idx + ')" ' +
              'title="' + (isAct ? 'Active Fighter: ' + m.name : (isFainted ? m.name + ' has fainted!' : 'Click to Switch In ' + m.name + '!')) + '" ' +
              'class="squad-slot-pill p-1.5 rounded-xl bg-[#0D1224] border border-white/20 flex flex-col gap-1 text-left ' + pillCls + '">' +
        '<div class="flex items-center justify-between gap-1">' +
          '<div class="flex items-center gap-1 min-w-0">' +
            '<svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="' + ballColor + '" stroke-width="2.2"/><line x1="3" y1="12" x2="21" y2="12" stroke="' + ballColor + '" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="' + ballColor + '"/></svg>' +
            '<img src="' + getArtworkFallbackUrl(m.id, m.shiny) + '" class="w-5 h-5 object-contain shrink-0" />' +
            '<span class="text-[10px] font-extrabold text-white truncate">' + m.name + '</span>' +
          '</div>' +
          statusTag +
        '</div>' +
        '<div class="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-white/10">' +
          '<div class="h-full ' + hpColor + ' transition-all duration-300" style="width:' + hpPct + '%;"></div>' +
        '</div>' +
      '</button>'
    );
  }).join('');
}

function renderDrawerSixTeamSlots() {
  const row = document.getElementById('drawerSixTeamSlotsRow');
  if (!row) return;
  ensureSquadTeamsInitialized();
  const selSide = stadiumDockTargetSlot === 2 ? 2 : 1;
  const selIdx = stadiumBattleState.drawerTargetSlotIdx ?? 0;

  const cards = [];
  [1, 2].forEach(sideNum => {
    const team = sideNum === 1 ? stadiumBattleState.team1 : stadiumBattleState.team2;
    team.forEach((m, idx) => {
      const isSelected = (sideNum === selSide && idx === selIdx);
      const sideTag = sideNum === 1 ? ('P1: Slot ' + (idx + 1)) : ('P2: Slot ' + (idx + 1));
      const borderCls = isSelected
        ? 'border-cyan-400 bg-cyan-500/20 shadow-[0_0_14px_rgba(0,240,255,0.4)]'
        : 'border-white/15 bg-[#060811] hover:border-cyan-400/50';
      cards.push(
        '<button onclick="selectDrawerTeamSlot(' + sideNum + ', ' + idx + ')" ' +
                'class="p-2 rounded-xl border ' + borderCls + ' flex items-center gap-2 text-left transition active:scale-95">' +
          '<img src="' + getArtworkFallbackUrl(m.id, m.shiny) + '" class="w-8 h-8 object-contain shrink-0" />' +
          '<div class="min-w-0 flex-1">' +
            '<div class="text-[9px] font-mono-num font-black uppercase ' + (sideNum === 1 ? 'text-cyan-300' : 'text-amber-300') + '">' + sideTag + (isSelected ? ' • [EDITING]' : '') + '</div>' +
            '<div class="text-xs font-extrabold text-white truncate">' + (m.shiny ? '✦ ' : '') + m.name + '</div>' +
          '</div>' +
        '</button>'
      );
    });
  });
  row.innerHTML = cards.join('');
}

function selectDrawerTeamSlot(sideNum, slotIdx) {
  stadiumDockTargetSlot = sideNum === 2 ? 2 : 1;
  stadiumBattleState.drawerTargetSlotIdx = slotIdx;
  setStadiumDockTarget(stadiumDockTargetSlot);
  renderDrawerSixTeamSlots();
}

function toggleStadiumSquadDrawer(ev) {
  if (ev) ev.stopPropagation();
  const drawer = document.getElementById('stadiumSquadDrawer');
  if (!drawer) return;
  if (drawer.classList.contains('hidden')) {
    renderDrawerSixTeamSlots();
    renderStadiumRosterDock();
    drawer.classList.remove('hidden');
  } else {
    drawer.classList.add('hidden');
  }
}

function closeStadiumSquadDrawer() {
  const drawer = document.getElementById('stadiumSquadDrawer');
  if (drawer && !drawer.classList.contains('hidden')) {
    drawer.classList.add('hidden');
  }
}

function renderStadiumCombatUI() {
  ensureSquadTeamsInitialized();
  const s1 = syncActiveSquadMemberWithPartnerState(1);
  const s2 = syncActiveSquadMemberWithPartnerState(2);
  stadiumBattleState.slot1Hp = s1.hp;
  stadiumBattleState.slot1MaxHp = s1.maxHp;
  stadiumBattleState.slot2Hp = s2.hp;
  stadiumBattleState.slot2MaxHp = s2.maxHp;

  renderSquadHudForSide(1);
  renderSquadHudForSide(2);
  renderDrawerSixTeamSlots();

  // Update Compact Single-Line Stat Summary Pills
  const spec1 = getEffectiveSlotSpectrum(s1);
  const spec2 = getEffectiveSlotSpectrum(s2);
  const matchup = getTypeMatchup(s1.types || [s1.type], s2.types || [s2.type]);
  const statCard1 = document.getElementById('cutinStatCardSlot1');
  const statCard2 = document.getElementById('cutinStatCardSlot2');
  if (statCard1) statCard1.textContent = renderPokedexStatCardHtml(s1, spec1, matchup.slot1Mult, matchup.slot2Mult);
  if (statCard2) statCard2.textContent = renderPokedexStatCardHtml(s2, spec2, matchup.slot2Mult, matchup.slot1Mult);

  const updateHpBar = (slotNum, memberObj) => {
    const curHp = memberObj.hp;
    const maxHp = memberObj.maxHp;
    const pct = Math.max(0, Math.min(100, Math.round((curHp / Math.max(1, maxHp)) * 100)));
    const lbl = document.getElementById('stadiumHpLabelSlot' + slotNum);
    const bar = document.getElementById('stadiumHpBarSlot' + slotNum);
    const badge = document.getElementById('stadiumStatusBadgeSlot' + slotNum);
    const ailBadge = document.getElementById('stadiumAilmentBadgeSlot' + slotNum);
    const art = document.getElementById('cutinArtSlot' + slotNum);

    let barColor = 'bg-emerald-400';
    let txtColor = 'text-emerald-300';
    if (pct === 0) {
      barColor = 'bg-rose-600';
      txtColor = 'text-rose-400';
    } else if (pct < 20) {
      barColor = 'bg-rose-500 shadow-[0_0_12px_#EF4444]';
      txtColor = 'text-rose-400';
    } else if (pct < 50) {
      barColor = 'bg-amber-400 shadow-[0_0_10px_#FACC15]';
      txtColor = 'text-amber-300';
    } else {
      barColor = 'bg-emerald-400 shadow-[0_0_10px_#10B981]';
    }

    if (lbl) {
      lbl.innerText = 'HP: ' + curHp + ' / ' + maxHp + ' (' + pct + '%)';
      lbl.className = txtColor + ' font-mono-num font-extrabold';
    }
    if (bar) {
      bar.className = 'h-full rounded-full transition-all duration-300 ' + barColor;
      bar.style.width = pct + '%';
    }
    if (ailBadge) {
      const effAilment = memberObj.shieldActive ? 'SHD' : memberObj.ailment;
      if (effAilment && STATUS_BADGE_STYLES[effAilment]) {
        ailBadge.innerText = STATUS_BADGE_STYLES[effAilment].label;
        ailBadge.className = 'text-[9px] px-1.5 py-0.5 rounded font-mono-num font-black ' + STATUS_BADGE_STYLES[effAilment].cls;
      } else {
        ailBadge.className = 'hidden';
      }
    }
    if (badge) {
      if (curHp <= 0) {
        badge.innerText = 'FAINTED!';
        badge.className = 'text-[10px] px-2 py-0.5 rounded bg-rose-500/30 text-rose-200 border border-rose-400/60 font-black';
        if (art) art.classList.add('fainted-pokemon');
      } else if (memberObj.megaActive) {
        badge.innerText = '⟦ MEGA +35% ⟧';
        badge.className = 'text-[10px] px-2 py-0.5 rounded bg-amber-400/30 text-amber-200 border border-amber-300 font-black';
        if (art) {
          art.classList.remove('fainted-pokemon');
          art.classList.add('mega-overdrive-art');
        }
      } else if (memberObj.overclock2x) {
        badge.innerText = '⟦ 2x DMG ARMED ⟧';
        badge.className = 'text-[10px] px-2 py-0.5 rounded bg-cyan-400/30 text-cyan-200 border border-cyan-300 font-black';
      } else if (memberObj.shieldActive) {
        badge.innerText = '⟦ SHIELD -50% ⟧';
        badge.className = 'text-[10px] px-2 py-0.5 rounded bg-indigo-500/30 text-indigo-200 border border-indigo-400 font-black';
      } else {
        badge.innerText = pct < 25 ? 'CRITICAL' : 'BATTLE READY';
        badge.className = pct < 25
          ? 'text-[10px] px-2 py-0.5 rounded bg-amber-500/25 text-amber-200 border border-amber-400/50 font-bold'
          : 'text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 font-bold';
        if (art) {
          art.classList.remove('fainted-pokemon', 'mega-overdrive-art');
        }
      }
    }
  };

  updateHpBar(1, s1);
  updateHpBar(2, s2);

  // Update Player 1 & Player 2 AP Pool Counters (0 to 25 AP Max)
  const ap1 = Math.min(25, Math.max(0, Number(stadiumBattleState.apPool1 ?? 6)));
  const ap2 = Math.min(25, Math.max(0, Number(stadiumBattleState.apPool2 ?? 6)));
  const activeTurn = Number(stadiumBattleState.activeTurnSlot || 1);
  const turnRolled = Boolean(stadiumBattleState.turnRolled);

  const apHdr1 = document.getElementById('apPoolHeaderSlot1');
  const apBar1 = document.getElementById('apPoolBarSlot1');
  const megaTxt1 = document.getElementById('megaGaugeTextSlot1');
  if (apHdr1) apHdr1.innerText = "LOGAN'S AP POOL: " + ap1 + " / 25 MAX";
  if (apBar1) apBar1.style.width = Math.round((ap1 / 25) * 100) + '%';
  if (megaTxt1) megaTxt1.innerText = s1.megaActive ? '✦ MEGA +35% ACTIVE!' : (ap1 >= 18 ? '⚡ 18 AP ULTIMATE READY!' : ('ULTIMATE: ' + ap1 + '/18 AP'));

  const p2NameLabel = stadiumBattleState.gameMode === 'HOTSEAT_2P'
    ? "DAD'S AP POOL: "
    : (stadiumBattleState.gauntletStage > 0 ? "BOSS AP POOL: " : "OPPONENT'S AP POOL: ");
  const apHdr2 = document.getElementById('apPoolHeaderSlot2');
  const apBar2 = document.getElementById('apPoolBarSlot2');
  const megaTxt2 = document.getElementById('megaGaugeTextSlot2');
  if (apHdr2) apHdr2.innerText = p2NameLabel + ap2 + " / 25 MAX";
  if (apBar2) apBar2.style.width = Math.round((ap2 / 25) * 100) + '%';
  if (megaTxt2) megaTxt2.innerText = s2.megaActive ? '✦ MEGA +35% ACTIVE!' : (ap2 >= 18 ? '⚡ 18 AP ULTIMATE READY!' : ('ULTIMATE: ' + ap2 + '/18 AP'));

  // Update Center 3-Step Turn Guide Ribbon & Roll / Bank Buttons
  const ownerBanner = document.getElementById('activeTurnOwnerBanner');
  if (ownerBanner) {
    ownerBanner.innerText = activeTurn === 1
      ? 'ACTIVE TURN: LOGAN (PLAYER 1) • ' + ap1 + ' AP'
      : ('ACTIVE TURN: ' + (stadiumBattleState.gameMode === 'HOTSEAT_2P' ? 'DAD (PLAYER 2)' : 'BOSS / AI (P2)') + ' • ' + ap2 + ' AP');
    ownerBanner.className = 'text-[9px] font-pokedex font-extrabold uppercase tracking-wider text-center ' + (activeTurn === 1 ? 'text-cyan-300' : 'text-amber-300');
  }

  const step1El = document.getElementById('turnStep1Pill');
  const step2El = document.getElementById('turnStep2Pill');
  const step3El = document.getElementById('turnStep3Pill');
  const rollBtn = document.getElementById('rollD20ApBtn');
  const bankBtn = document.getElementById('bankApEndTurnBtn');
  const activePoolVal = activeTurn === 1 ? ap1 : ap2;

  if (!turnRolled) {
    if (step1El) step1El.className = 'px-2 py-1 rounded-lg bg-amber-400 text-slate-950 border border-white text-center shadow-[0_0_12px_rgba(250,204,21,0.65)] transition';
    if (step2El) step2El.className = 'px-2 py-1 rounded-lg bg-[#10162B] text-slate-400 border border-white/10 text-center transition';
    if (step3El) step3El.className = 'px-2 py-1 rounded-lg bg-[#10162B] text-slate-400 border border-white/10 text-center transition';
    if (rollBtn) {
      rollBtn.innerText = '[ 🎲 ROLL D20 FOR AP (' + (activeTurn === 1 ? 'LOGAN' : 'P2') + ') ]';
      rollBtn.className = 'w-full py-2 px-3 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 hover:from-amber-300 hover:to-yellow-200 text-slate-950 font-pokedex font-black text-xs uppercase tracking-wider shadow-[0_0_22px_rgba(250,204,21,0.75)] animate-pulse transition active:scale-95';
    }
  } else {
    if (step1El) step1El.className = 'px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-center transition';
    if (step2El) step2El.className = 'px-2 py-1 rounded-lg bg-cyan-400 text-slate-950 border border-white text-center shadow-[0_0_12px_rgba(0,240,255,0.55)] transition';
    if (step3El) step3El.className = 'px-2 py-1 rounded-lg bg-emerald-400/25 text-emerald-200 border border-emerald-400/60 text-center transition';
    if (rollBtn) {
      rollBtn.innerText = '✓ D20 ROLLED (' + activePoolVal + ' AP READY TO SPEND)';
      rollBtn.className = 'w-full py-1.5 px-3 rounded-xl bg-slate-800/90 text-emerald-300 border border-emerald-400/40 font-pokedex font-black text-[10px] uppercase tracking-wider transition';
    }
  }

  if (bankBtn) {
    bankBtn.innerText = '[ ⏭️ PASS & BANK +' + activePoolVal + ' AP FOR NEXT TURN ]';
    bankBtn.className = (turnRolled && activePoolVal < 5)
      ? 'w-full py-1.5 px-2.5 rounded-xl bg-emerald-400 text-slate-950 border border-white font-pokedex font-black text-[10px] uppercase tracking-wider shadow-[0_0_16px_rgba(16,185,129,0.6)] animate-pulse transition active:scale-95'
      : 'w-full py-1.5 px-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/60 text-emerald-200 font-pokedex font-black text-[10px] uppercase tracking-wider transition active:scale-95';
  }

  // Render Large, Un-Truncated 2x2 Move Deck Grid with Clear AP Cost Badges & Affordability Gating
  const renderMovesGrid = (slotNum, attackerObj, defenderObj) => {
    const container = document.getElementById('stadiumMovesSlot' + slotNum);
    if (!container) return;
    const moves = getFourMovesForPokemon(attackerObj);
    if (!Array.isArray(attackerObj.movePp) || attackerObj.movePp.length !== 4) {
      attackerObj.movePp = moves.map(m => Number(m.maxPp || (m.ultimate ? 5 : 15)));
    }
    if (!Array.isArray(attackerObj.moveCooldowns) || attackerObj.moveCooldowns.length !== 4) {
      attackerObj.moveCooldowns = [0, 0, 0, 0];
    }
    const sideAp = slotNum === 1 ? ap1 : ap2;

    container.innerHTML = moves.map((m, idx) => {
      const apCost = Number(m.apCost || MOVE_AP_COSTS[idx] || 5);
      const eff = computeMoveEffectiveness(m.type, defenderObj.types || [defenderObj.type]);
      const effTag = eff > 1
        ? (eff + 'x SUPER')
        : (eff === 0 ? '0x IMMUNE' : (eff < 1 ? (eff + 'x RESIST') : '1x HIT'));
      const effCls = eff > 1
        ? 'text-emerald-300 bg-emerald-500/20 border-emerald-400/50'
        : (eff < 1 ? 'text-amber-300 bg-amber-500/15 border-amber-400/40' : 'text-slate-300 bg-white/5 border-white/15');
      const typeHex = (ELEMENTAL_SPECTRUM[m.type] || ELEMENTAL_SPECTRUM.normal).hex;

      const cdLeft = Number(attackerObj.moveCooldowns[idx] || 0);
      const isUlt = idx === 3 || Boolean(m.ultimate);
      const canAfford = sideAp >= apCost;
      const isUnlocked = canAfford && cdLeft <= 0;

      let statusPillHtml = '';
      if (cdLeft > 0) {
        statusPillHtml = '<span class="text-[8px] font-mono-num font-black text-rose-300 bg-rose-500/25 px-1.5 py-0.5 rounded border border-rose-400/50">⏳ ' + cdLeft + 'T CD</span>';
      } else if (isUnlocked) {
        statusPillHtml = isUlt
          ? '<span class="text-[8px] font-mono-num font-black text-amber-200 bg-amber-500/30 px-1.5 py-0.5 rounded border border-amber-300 animate-pulse">⚡ MEGA ULT UNLOCKED!</span>'
          : '<span class="text-[8px] font-mono-num font-black text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-400/50">UNLOCKED • FIRE</span>';
      } else {
        statusPillHtml = isUlt
          ? '<span class="text-[8px] font-mono-num font-extrabold text-amber-200/80 bg-black/60 px-1.5 py-0.5 rounded border border-amber-400/40">🔒 NEEDS 18 AP (BANK TURN)</span>'
          : '<span class="text-[8px] font-mono-num font-bold text-slate-400 bg-black/50 px-1.5 py-0.5 rounded border border-white/10">🔒 NEEDS ' + apCost + ' AP (ROLL D20)</span>';
      }

      const costBadgeCls = isUnlocked
        ? (isUlt ? 'bg-amber-400 text-slate-950 border-white shadow-[0_0_10px_#FACC15]' : 'bg-cyan-400 text-slate-950 border-white')
        : 'bg-slate-900 text-slate-300 border-white/20';

      const borderCls = isUnlocked
        ? (isUlt
            ? 'border-2 border-amber-300 bg-gradient-to-r from-amber-500/30 to-purple-600/35 shadow-[0_0_18px_rgba(250,204,21,0.45)]'
            : 'border-2 border-emerald-400/80 bg-[#0F1B33] hover:bg-[#162647] shadow-[0_0_12px_rgba(16,185,129,0.22)]')
        : 'border border-white/10 bg-[#090D1A] opacity-60 hover:opacity-85';

      return (
        '<button onclick="executeStadiumMove(' + slotNum + ', ' + idx + ')" ' +
                'class="p-2 rounded-xl ' + borderCls + ' text-left transition active:scale-95 flex flex-col justify-between gap-1 min-w-0">' +
          '<div class="flex items-center justify-between gap-1">' +
            '<span class="text-[11px] font-extrabold text-white whitespace-nowrap truncate">' + m.name + '</span>' +
            '<span class="px-1.5 py-0.5 rounded font-pokedex font-black text-[9px] border shrink-0 ' + costBadgeCls + '">COST: ' + apCost + ' AP</span>' +
          '</div>' +
          '<div class="flex items-center justify-between gap-1 flex-wrap text-[8px] font-mono-num">' +
            '<span class="px-1 py-0.2 rounded uppercase font-black text-white border border-white/20" style="background:' + typeHex + '55;">' + m.type + ' • PWR ' + m.power + '</span>' +
            '<span class="font-black px-1 py-0.2 rounded border ' + effCls + ' whitespace-nowrap">' + effTag + '</span>' +
            statusPillHtml +
          '</div>' +
        '</button>'
      );
    }).join('');
  };

  renderMovesGrid(1, s1, s2);
  renderMovesGrid(2, s2, s1);

  // Update Separate Trainer Bags for Logan (Slot 1) and Dad/Boss (Slot 2)
  const bag1 = stadiumBattleState.bag1 || { potions: 2, xAttacks: 1, balls: 3 };
  const bag2 = stadiumBattleState.bag2 || { potions: 2, xAttacks: 1, balls: 3 };
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = String(val); };
  setTxt('bagCount1_POTION', bag1.potions ?? 2);
  setTxt('bagCount1_X_ATTACK', bag1.xAttacks ?? 1);
  setTxt('bagCount1_BALL', bag1.balls ?? 3);
  setTxt('bagCount2_POTION', bag2.potions ?? 2);
  setTxt('bagCount2_X_ATTACK', bag2.xAttacks ?? 1);
  setTxt('bagCount2_BALL', bag2.balls ?? 3);

  const relicsBadge = document.getElementById('loganEquippedRelicsBadge');
  if (relicsBadge) {
    const lc = stadiumBattleState.luckyCharmLevel || 0;
    const mc = stadiumBattleState.megaCoreLevel || 0;
    const parts = [];
    if (lc > 0) parts.push('🍀 Lucky +' + (lc * 2) + ' D20');
    if (mc > 0) parts.push('⚡ Core +3 AP');
    parts.push('🟣 ' + (stadiumBattleState.masterBalls ?? 3) + ' Master');
    relicsBadge.innerText = parts.join(' • ');
  }

  const p2BagHdr = document.getElementById('p2BagHeaderTitle');
  if (p2BagHdr) {
    p2BagHdr.innerText = stadiumBattleState.gameMode === 'HOTSEAT_2P'
      ? "🎒 DAD'S TRAINER BAG & GEAR"
      : "🎒 BOSS / OPPONENT BAG & GEAR";
  }

  const enemyHpRatio = s2.hp / Math.max(1, s2.maxHp);
  const isCatchZone = (enemyHpRatio <= 0.35 && s2.hp > 0) || Boolean(s2.shiny);
  const ballBtn1 = document.getElementById('bagBtn1_BALL');
  if (ballBtn1) {
    if (isCatchZone) {
      ballBtn1.classList.add('animate-pulse', 'ring-2', 'ring-amber-400', 'shadow-[0_0_16px_#FACC15]');
    } else {
      ballBtn1.classList.remove('animate-pulse', 'ring-2', 'ring-amber-400', 'shadow-[0_0_16px_#FACC15]');
    }
  }

  // Update Stadium Evolve & Shiny Buttons
  [1, 2].forEach(slotNum => {
    const slotObj = slotNum === 1 ? s1 : s2;
    const evoBtn = document.getElementById('stadiumEvoBtnSlot' + slotNum);
    const shinyBtn = document.getElementById('stadiumShinyBtnSlot' + slotNum);
    const chainInfo = evoChainCache[slotObj.id] || HALL_OF_FAME_DEX[slotObj.id] || {};
    const chainArr = Array.isArray(slotObj.chain) && slotObj.chain.length > 0 ? slotObj.chain : (chainInfo.chain || [slotObj.id]);
    const nextId = slotObj.nextId !== undefined ? slotObj.nextId : (chainInfo.nextId || null);
    if (evoBtn) {
      if (nextId) {
        evoBtn.innerText = 'Evolve (+30% HP)';
      } else if (chainArr.length > 1) {
        evoBtn.innerText = 'Reset Stage 1';
      } else {
        evoBtn.innerText = 'MAX FORM';
      }
    }
    if (shinyBtn) {
      shinyBtn.innerText = slotObj.shiny ? '✨ Shiny: ON' : '✨ Shiny: OFF';
    }
  });

  const sndState = document.getElementById('stadiumSoundState');
  if (sndState) {
    sndState.innerText = partnerState.cryAudio ? 'ON' : 'MUTE';
    sndState.className = partnerState.cryAudio ? 'text-emerald-300 font-extrabold' : 'text-rose-400 font-extrabold';
  }

  const trophyCnt = document.getElementById('stadiumTrophyCount');
  if (trophyCnt) trophyCnt.innerText = String((stadiumBattleState.trophyLocker || []).length);

  const mbBadge = document.getElementById('masterBallCountBadge');
  if (mbBadge) mbBadge.innerText = String(stadiumBattleState.masterBalls ?? 3);

  const streakEl = document.getElementById('stadiumStreakBadge');
  if (streakEl) streakEl.innerText = 'WIN STREAK: ' + String(stadiumBattleState.winStreak || 0);

  const gLabel = document.getElementById('stadiumGauntletLabel');
  if (gLabel) {
    gLabel.innerText = stadiumBattleState.gauntletStage > 0
      ? ('Stage ' + stadiumBattleState.gauntletStage + '/5')
      : 'Tower';
  }

  const curMode = stadiumBattleState.gameMode || 'FREE_ARENA';
  ['GAUNTLET', 'FREE_ARENA', 'HOTSEAT_2P'].forEach(mKey => {
    const mBtn = document.getElementById('modeBtn_' + mKey);
    if (!mBtn) return;
    const active = (mKey === 'GAUNTLET' && stadiumBattleState.gauntletStage > 0) || (curMode === mKey && stadiumBattleState.gauntletStage === 0);
    mBtn.className = active
      ? 'px-2.5 py-1.5 rounded-lg bg-cyan-400 text-slate-950 border border-white text-[10px] font-mono-num font-black whitespace-nowrap shadow-[0_0_14px_rgba(0,240,255,0.5)] transition active:scale-95'
      : 'px-2.5 py-1.5 rounded-lg bg-[#12172B] hover:bg-white/15 border border-white/20 text-[10px] font-mono-num font-black text-slate-200 whitespace-nowrap transition active:scale-95';
  });
}

/* =====================================================================
 * 4 VISUALLY DISTINCT ATTACK ANIMATIONS:
 * - Move 1 (idx 0): High-speed dash lunge + criss-cross X-slash impact
 * - Move 2 (idx 1): Thick glowing elemental laser beam from attacker to target
 * - Move 3 (idx 2): Elemental storm/vortex particles over defender + status badge
 * - Move 4 (idx 3): Full-screen dramatic dim + orbital energy pillar + heavy shake
 * ===================================================================== */
function spawnElementalProjectile(attackerSlot, colorHex, isUltimate, moveIdx = 0, statusCode = null) {
  const layer = document.getElementById('stadiumProjectileLayer');
  if (!layer) return;
  const startX = attackerSlot === 1 ? 22 : 78;
  const endX = attackerSlot === 1 ? 78 : 22;
  const targetY = 54;

  if (isUltimate || moveIdx === 3) {
    // MOVE 4 (ULTIMATE): Full-screen dramatic dim + orbital energy pillar + shockwave ring
    const dim = document.createElement('div');
    dim.style.cssText = 'position:fixed;inset:0;background:rgba(2,4,12,0.78);z-index:24;opacity:0;transition:opacity 0.15s ease;';
    layer.appendChild(dim);

    const pillar = document.createElement('div');
    pillar.style.cssText =
      'position:fixed;top:0;bottom:0;left:' + endX + 'vw;width:150px;transform:translateX(-50%) scaleX(0.1);' +
      'background:linear-gradient(90deg, transparent 0%, ' + colorHex + ' 22%, #FFFFFF 50%, ' + colorHex + ' 78%, transparent 100%);' +
      'box-shadow:0 0 80px ' + colorHex + ', 0 0 140px #FACC15;z-index:26;opacity:0.95;transition:transform 0.28s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease;';
    layer.appendChild(pillar);

    const ring = document.createElement('div');
    ring.style.cssText =
      'position:fixed;top:' + targetY + 'vh;left:' + endX + 'vw;width:40px;height:40px;border-radius:9999px;' +
      'border:6px solid #FFFFFF;box-shadow:0 0 50px ' + colorHex + ';transform:translate(-50%,-50%) scale(0.4);' +
      'z-index:27;transition:transform 0.42s ease-out, opacity 0.42s ease-out;';
    layer.appendChild(ring);

    requestAnimationFrame(() => {
      dim.style.opacity = '1';
      pillar.style.transform = 'translateX(-50%) scaleX(1.35)';
      ring.style.transform = 'translate(-50%,-50%) scale(6.5)';
      ring.style.opacity = '0';
    });

    setTimeout(() => {
      dim.style.opacity = '0';
      pillar.style.opacity = '0';
      setTimeout(() => { dim.remove(); pillar.remove(); ring.remove(); }, 220);
    }, 460);
    return;
  }

  if (moveIdx === 1) {
    // MOVE 2: Thick glowing elemental laser beam from attacker to target
    const beam = document.createElement('div');
    const leftPos = Math.min(startX, endX);
    const widthVw = Math.abs(endX - startX);
    const originSide = attackerSlot === 1 ? 'left center' : 'right center';
    beam.style.cssText =
      'position:fixed;top:' + targetY + 'vh;left:' + leftPos + 'vw;width:' + widthVw + 'vw;height:30px;' +
      'border-radius:9999px;background:linear-gradient(180deg, ' + colorHex + ' 0%, #FFFFFF 50%, ' + colorHex + ' 100%);' +
      'box-shadow:0 0 36px ' + colorHex + ', 0 0 72px ' + colorHex + ';transform:translateY(-50%) scaleX(0.05);' +
      'transform-origin:' + originSide + ';transition:transform 0.22s cubic-bezier(0.16,1,0.3,1), opacity 0.22s ease;z-index:26;';
    layer.appendChild(beam);

    requestAnimationFrame(() => {
      beam.style.transform = 'translateY(-50%) scaleX(1)';
    });
    setTimeout(() => {
      beam.style.opacity = '0';
      setTimeout(() => beam.remove(), 160);
    }, 280);
    return;
  }

  if (moveIdx === 2) {
    // MOVE 3: Elemental storm/vortex particles over defender + status effect badge
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      const angle = (i / 12) * Math.PI * 2;
      const rStart = 110;
      const dx = Math.cos(angle) * rStart;
      const dy = Math.sin(angle) * rStart;
      p.style.cssText =
        'position:fixed;top:' + targetY + 'vh;left:' + endX + 'vw;width:18px;height:18px;border-radius:9999px;' +
        'background:radial-gradient(circle, #FFFFFF 0%, ' + colorHex + ' 70%);box-shadow:0 0 22px ' + colorHex + ';' +
        'transform:translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px)) scale(1.2);' +
        'transition:transform 0.34s cubic-bezier(0.22,1,0.36,1), opacity 0.34s ease;z-index:26;';
      layer.appendChild(p);
      requestAnimationFrame(() => {
        p.style.transform = 'translate(-50%, -50%) rotate(180deg) scale(0.2)';
        p.style.opacity = '0';
      });
      setTimeout(() => p.remove(), 380);
    }
    if (statusCode && STATUS_BADGE_STYLES[statusCode]) {
      const sb = document.createElement('div');
      sb.className = 'px-3 py-1 rounded-full font-mono-num font-black text-xs shadow-2xl ' + STATUS_BADGE_STYLES[statusCode].cls;
      sb.style.cssText = 'position:fixed;top:' + (targetY - 12) + 'vh;left:' + endX + 'vw;transform:translate(-50%,-50%) scale(0.7);transition:all 0.32s ease;z-index:28;';
      sb.innerText = STATUS_BADGE_STYLES[statusCode].label + ' STORM!';
      layer.appendChild(sb);
      requestAnimationFrame(() => {
        sb.style.transform = 'translate(-50%, -85%) scale(1.15)';
      });
      setTimeout(() => {
        sb.style.opacity = '0';
        setTimeout(() => sb.remove(), 180);
      }, 520);
    }
    return;
  }

  // MOVE 1 (Default idx 0): High-speed dash lunge + glowing X-Slash impact over target
  [-42, 42].forEach(deg => {
    const slash = document.createElement('div');
    slash.style.cssText =
      'position:fixed;top:' + targetY + 'vh;left:' + endX + 'vw;width:150px;height:10px;border-radius:9999px;' +
      'background:linear-gradient(90deg, transparent, #FFFFFF, ' + colorHex + ', #FFFFFF, transparent);' +
      'box-shadow:0 0 28px ' + colorHex + ';transform:translate(-50%,-50%) rotate(' + deg + 'deg) scaleX(0.1);' +
      'transition:transform 0.22s cubic-bezier(0.22,1,0.36,1), opacity 0.22s ease;z-index:26;';
    layer.appendChild(slash);
    requestAnimationFrame(() => {
      slash.style.transform = 'translate(-50%,-50%) rotate(' + deg + 'deg) scaleX(1.3)';
    });
    setTimeout(() => {
      slash.style.opacity = '0';
      setTimeout(() => slash.remove(), 140);
    }, 240);
  });
}

async function loadBattleDeckPreset(deckKey) {
  stopAutoSimBattle();
  ensureSquadTeamsInitialized();
  const targetSide = stadiumDockTargetSlot === 2 ? 2 : 1;
  let ids = [384, 445, 149];
  let label = 'MYSTERY 3v3';

  if (deckKey === 'RANDOM_MYSTERY') {
    const pool = [...POWERHOUSE_POOL_IDS].sort(() => Math.random() - 0.5);
    ids = pool.slice(0, 3);
  } else if (BATTLE_DECK_PRESETS[deckKey]) {
    ids = BATTLE_DECK_PRESETS[deckKey].ids;
    label = BATTLE_DECK_PRESETS[deckKey].label;
  }

  await Promise.all(ids.map(id => ensurePokemonMetadata(id)));
  const newTeam = ids.map(id => buildSquadMemberFromId(id, deckKey === 'RANDOM_MYSTERY' ? (Math.random() < (1 / 6)) : false));

  if (targetSide === 1) {
    stadiumBattleState.team1 = newTeam;
    stadiumBattleState.activeIdx1 = 0;
    partnerState.slot1 = { ...newTeam[0] };
  } else {
    stadiumBattleState.team2 = newTeam;
    stadiumBattleState.activeIdx2 = 0;
    partnerState.slot2 = { ...newTeam[0] };
  }

  applyPartnerThemeAndHeader();
  playPokemonCry(newTeam[0].id);
  triggerClashCutIn({
    force: true,
    headline: partnerState.slot1.name.toUpperCase() + ' VS ' + partnerState.slot2.name.toUpperCase()
  });

  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');
  if (logTitle) logTitle.innerText = '⟦ ' + label + ' SQUAD DEPLOYED! ⟧';
  if (logText) logText.innerText = 'Loaded ' + newTeam.map(m => m.name).join(', ') + ' into Side ' + targetSide + '!';
}

function toggleTrophyLocker(ev) {
  if (ev) ev.stopPropagation();
  const modal = document.getElementById('stadiumTrophyLockerModal');
  if (!modal) return;
  if (!modal.classList.contains('hidden')) {
    modal.classList.add('hidden');
    return;
  }
  ensureSquadTeamsInitialized();
  renderTrophyLockerUI();
  modal.classList.remove('hidden');
}

function renderTrophyLockerUI() {
  const badgesRow = document.getElementById('trophyLockerBadgesRow');
  const grid = document.getElementById('trophyLockerGrid');
  if (badgesRow) {
    badgesRow.innerHTML = CHAMPION_GAUNTLET_STAGES.map(st => {
      const unlocked = (stadiumBattleState.badges || []).includes(st.badge);
      return (
        '<div class="px-2.5 py-1 rounded-lg border text-[10px] font-mono-num font-black flex items-center gap-1.5 ' +
          (unlocked ? 'bg-amber-500/25 border-amber-400 text-amber-200 shadow-[0_0_12px_rgba(250,204,21,0.3)]' : 'bg-white/5 border-white/10 text-slate-500') + '">' +
          '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2l3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 9l6-1z"/></svg>' +
          '<span>' + st.badge + (unlocked ? ' ✓' : ' (LOCKED)') + '</span>' +
        '</div>'
      );
    }).join('');
  }
  if (grid) {
    const list = stadiumBattleState.trophyLocker || [];
    if (list.length === 0) {
      grid.innerHTML = '<div class="col-span-full text-center text-xs text-slate-400 py-8">No Pokémon caught yet! Throw a Capture Ball or Master Ball in battle!</div>';
      return;
    }
    grid.innerHTML = list.map((item, idx) => (
      '<div class="p-2.5 rounded-xl bg-[#141126] border ' + (item.shiny ? 'border-amber-400/70 shadow-[0_0_15px_rgba(250,204,21,0.25)]' : 'border-white/15') + ' flex flex-col items-center gap-1">' +
        '<img src="' + getArtworkFallbackUrl(item.id, item.shiny) + '" class="w-16 h-16 object-contain" />' +
        '<span class="text-xs font-black text-white truncate max-w-full">' + (item.shiny ? '✦ SHINY ' : '') + item.name + '</span>' +
        '<span class="text-[9px] font-mono-num font-bold text-cyan-300">#' + item.id + ' • BST ' + (item.bst || 540) + '</span>' +
        '<button onclick="equipTrophyPokemon(' + idx + ')" class="mt-1 w-full py-1 px-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono-num font-black text-[9px] uppercase tracking-wider transition active:scale-95">Add to My 3v3 Squad</button>' +
      '</div>'
    )).join('');
  }
}

async function equipTrophyPokemon(lockerIdx) {
  const entry = (stadiumBattleState.trophyLocker || [])[lockerIdx];
  if (!entry) return;
  document.getElementById('stadiumTrophyLockerModal')?.classList.add('hidden');
  setStadiumDockTarget(1);
  await tagInStadiumPokemon(entry.id, Boolean(entry.shiny));
}

async function stadiumEvolvePokemon(slotNum) {
  await onEvolveClick(slotNum);
  const key = slotNum === 1 ? 'slot1' : 'slot2';
  const evolved = hydrateSlotFromDex(partnerState[key]);
  const team = slotNum === 1 ? stadiumBattleState.team1 : stadiumBattleState.team2;
  const idx = slotNum === 1 ? (stadiumBattleState.activeIdx1 || 0) : (stadiumBattleState.activeIdx2 || 0);
  if (Array.isArray(team) && team[idx]) {
    const newMax = calcMaxHpForSlot(evolved);
    team[idx] = {
      ...team[idx],
      ...evolved,
      maxHp: newMax,
      hp: Math.min(newMax, Math.round(team[idx].hp + newMax * 0.30)),
      movePp: getFourMovesForPokemon(evolved).map(m => Number(m.maxPp || 15)),
      moveCooldowns: [0, 0, 0, 0]
    };
  }
  stadiumBattleState.faintedSlot = 0;
  renderStadiumCombatUI();
}

function stadiumToggleShiny(slotNum) {
  onShinyToggleClick(slotNum);
  const s1 = hydrateSlotFromDex(partnerState.slot1);
  const s2 = hydrateSlotFromDex(partnerState.slot2);
  const art = document.getElementById('cutinArtSlot' + slotNum);
  const slotObj = slotNum === 1 ? s1 : s2;
  const team = slotNum === 1 ? stadiumBattleState.team1 : stadiumBattleState.team2;
  const idx = slotNum === 1 ? (stadiumBattleState.activeIdx1 || 0) : (stadiumBattleState.activeIdx2 || 0);
  if (Array.isArray(team) && team[idx]) team[idx].shiny = Boolean(slotObj.shiny);
  if (art) art.src = getArtworkFallbackUrl(slotObj.id, slotObj.shiny);
  const titleEl = document.getElementById(slotNum === 1 ? 'cutinLeftTitle' : 'cutinRightTitle');
  if (titleEl) titleEl.innerText = (slotObj.shiny ? 'SHINY ' : '') + slotObj.name.toUpperCase();
  renderStadiumCombatUI();
}

function setStadiumDockTarget(slotNum, slotIdx) {
  stadiumDockTargetSlot = slotNum === 2 ? 2 : 1;
  if (typeof slotIdx === 'number') {
    stadiumBattleState.drawerTargetSlotIdx = Math.max(0, Math.min(2, slotIdx));
  }
  const b1 = document.getElementById('stadiumDockSlot1Btn');
  const b2 = document.getElementById('stadiumDockSlot2Btn');
  if (b1 && b2) {
    b1.className = stadiumDockTargetSlot === 1
      ? 'px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-cyan-500 text-slate-950 whitespace-nowrap transition'
      : 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#161329] text-slate-300 border border-white/15 whitespace-nowrap transition';
    b2.className = stadiumDockTargetSlot === 2
      ? 'px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-orange-500 text-slate-950 whitespace-nowrap transition'
      : 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#161329] text-slate-300 border border-white/15 whitespace-nowrap transition';
  }
  renderDrawerSixTeamSlots();
}

function renderStadiumRosterDock() {
  const row = document.getElementById('stadiumDockRosterRow');
  if (!row) return;
  row.innerHTML = HOF_ROSTER_BUTTONS.map(item => {
    const isActive = partnerState.slot1.id === item.id || partnerState.slot2.id === item.id;
    const borderCls = isActive ? 'border-cyan-400 bg-cyan-500/20' : 'border-white/15 bg-[#151226]/90 hover:border-cyan-400/50 hover:bg-[#211C3A]';
    return (
      '<button onclick="tagInStadiumPokemon(' + item.id + ')" title="Assign ' + item.label + ' to selected team slot" ' +
              'class="shrink-0 px-2 py-1 rounded-lg border ' + borderCls + ' flex items-center gap-1.5 transition active:scale-95">' +
        '<img src="' + getArtworkFallbackUrl(item.id, false) + '" class="w-5 h-5 object-contain" />' +
        '<span class="text-[9px] font-extrabold text-white whitespace-nowrap">' + item.label + '</span>' +
      '</button>'
    );
  }).join('');
}

async function tagInStadiumPokemon(idOrName, forceShiny) {
  try {
    stopAutoSimBattle();
    ensureSquadTeamsInitialized();
    const slotNum = stadiumDockTargetSlot || 1;
    const key = slotNum === 1 ? 'slot1' : 'slot2';
    const meta = await ensurePokemonMetadata(idOrName);
    const chainData = await resolveFullEvolutionChain(meta.id);
    const newMember = buildSquadMemberFromId(meta.id, Boolean(forceShiny));
    newMember.nextId = chainData.nextId;
    newMember.baseId = chainData.baseId;
    newMember.chain = chainData.chain;

    const team = slotNum === 1 ? stadiumBattleState.team1 : stadiumBattleState.team2;
    const targetIdx = typeof stadiumBattleState.drawerTargetSlotIdx === 'number'
      ? Math.max(0, Math.min(2, stadiumBattleState.drawerTargetSlotIdx))
      : (slotNum === 1 ? (stadiumBattleState.activeIdx1 || 0) : (stadiumBattleState.activeIdx2 || 0));
    team[targetIdx] = newMember;

    if (slotNum === 1) stadiumBattleState.activeIdx1 = targetIdx;
    else stadiumBattleState.activeIdx2 = targetIdx;
    partnerState[key] = { ...newMember };

    applyPartnerThemeAndHeader();
    playPokemonCry(meta.id);
    triggerClashCutIn({
      force: true,
      slotNum,
      headline: partnerState.slot1.name.toUpperCase() + ' VS ' + partnerState.slot2.name.toUpperCase()
    });
    renderDrawerSixTeamSlots();
  } catch (e) {
    const logText = document.getElementById('stadiumBattleLogText');
    if (logText) logText.innerText = 'Could not find "' + idOrName + '". Try any Pokémon name or #1–1025.';
  }
}

function searchStadiumDockPokemon() {
  const inp = document.getElementById('stadiumDockSearchInput');
  const q = (inp?.value || '').trim().toLowerCase();
  if (!q) return;
  tagInStadiumPokemon(q);
}

function toggleBattleAutoClose(ev) {
  if (ev) ev.stopPropagation();
  partnerState.battleAutoClose = !partnerState.battleAutoClose;
  savePartnerStateToStorage();
  renderStadiumCombatUI();
  applyPartnerThemeAndHeader();
  clearTimeout(window.__cutinWipeoutTimer);
  if (partnerState.battleAutoClose) {
    window.__cutinWipeoutTimer = setTimeout(() => dismissClashCutIn(), 6000);
    showCommanderToast('Stadium Auto-Close: 6s Timer Enabled');
  } else {
    showCommanderToast('Stadium Hold-Open Mode: LOCKED OPEN');
  }
}

function toggleArenaSettingsPopover(ev) {
  if (ev) ev.stopPropagation();
  const pop = document.getElementById('arenaSettingsPopover');
  const backdrop = document.getElementById('arenaSettingsBackdrop');
  if (!pop) return;
  if (!pop.classList.contains('hidden')) {
    closeArenaSettingsPopover();
    return;
  }
  closeRosterPopover();
  if (backdrop && backdrop.parentElement !== document.body) {
    document.body.appendChild(backdrop);
  }
  if (pop.parentElement !== document.body) {
    document.body.appendChild(pop);
  }
  if (backdrop) backdrop.classList.remove('hidden');
  pop.classList.remove('hidden');

  const btn = document.getElementById('arenaSettingsBtn');
  if (btn && typeof btn.getBoundingClientRect === 'function') {
    const rect = btn.getBoundingClientRect();
    const popW = 256;
    const vw = window.innerWidth || 1440;
    const left = Math.max(12, Math.min(vw - popW - 12, rect.right - popW));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(rect.bottom + 8) + 'px';
    pop.style.right = 'auto';
  }
}

function closeArenaSettingsPopover() {
  document.getElementById('arenaSettingsBackdrop')?.classList.add('hidden');
  document.getElementById('arenaSettingsPopover')?.classList.add('hidden');
}

function openQuickTourModal() {
  closeArenaSettingsPopover();
  closeRosterPopover();
  const modal = document.getElementById('quickTourModal');
  if (!modal) return;
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeQuickTourModal() {
  const modal = document.getElementById('quickTourModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function renderPokedexStatCardHtml(slotObj) {
  const dex = HALL_OF_FAME_DEX[slotObj.id] || {};
  const st = slotObj.stats || dex.stats || { hp: 80, atk: 85, def: 75, spa: 80, spd: 75, spe: 80, bst: 475 };
  const typesStr = (slotObj.types || [slotObj.type || 'normal']).map(t => String(t).toUpperCase()).join('/');
  return '#' + slotObj.id + ' ' + typesStr + ' • BST ' + st.bst + ' • ATK ' + st.atk + ' / SPA ' + st.spa + ' / DEF ' + st.def + ' / SPE ' + st.spe;
}

function dismissClashCutIn(ev) {
  if (ev) ev.stopPropagation();
  stopAutoSimBattle();
  const overlay = document.getElementById('clash-cutin-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  document.body.classList.remove('stadium-modal-open');
  clearTimeout(window.__cutinHoldTimer);
  clearTimeout(window.__cutinWipeoutTimer);
  clearTimeout(window.__cutinHideTimer);
  overlay.classList.remove('phase-wipein', 'phase-hold');
  overlay.classList.add('phase-wipeout');
  const shell = document.getElementById('mainDashboardShell');
  if (shell) {
    shell.classList.remove('dashboard-focus-rise');
    void shell.offsetWidth;
    shell.classList.add('dashboard-focus-rise');
  }
  window.__cutinHideTimer = setTimeout(() => {
    overlay.classList.remove('active', 'phase-wipein', 'phase-hold', 'phase-wipeout');
  }, 650);
}

function triggerClashCutIn(opts = {}) {
  if (partnerState.cutInFx === false && !opts.force) return;
  const overlay = document.getElementById('clash-cutin-overlay');
  if (!overlay) return;

  document.body.classList.add('stadium-modal-open');

  const s1 = hydrateSlotFromDex(partnerState.slot1);
  const s2 = hydrateSlotFromDex(partnerState.slot2);
  const spec1 = getEffectiveSlotSpectrum(s1);
  const spec2 = getEffectiveSlotSpectrum(s2);
  const matchup = getTypeMatchup(s1.types || [s1.type], s2.types || [s2.type]);

  document.documentElement.style.setProperty('--seam-x1', matchup.seamX1);
  document.documentElement.style.setProperty('--seam-x2', matchup.seamX2);
  ['cutinSeamGlowLine', 'cutinSeamCoreLine'].forEach(lineId => {
    const ln = document.getElementById(lineId);
    if (ln) {
      ln.setAttribute('x1', matchup.seamX1);
      ln.setAttribute('x2', matchup.seamX2);
    }
  });

  const art1 = document.getElementById('cutinArtSlot1');
  const art2 = document.getElementById('cutinArtSlot2');
  const leftTitle = document.getElementById('cutinLeftTitle');
  const rightTitle = document.getElementById('cutinRightTitle');
  const leftSub = document.getElementById('cutinLeftSub');
  const rightSub = document.getElementById('cutinRightSub');
  const headline = document.getElementById('cutinBannerHeadline');
  const matchupBadge = document.getElementById('cutinMatchupBadge');
  const statCard1 = document.getElementById('cutinStatCardSlot1');
  const statCard2 = document.getElementById('cutinStatCardSlot2');

  if (art1) {
    art1.onerror = function() { this.onerror = null; this.src = getArtworkFallbackUrl(s1.id, false); };
    art1.src = getArtworkFallbackUrl(s1.id, s1.shiny);
  }
  if (art2) {
    art2.onerror = function() { this.onerror = null; this.src = getArtworkFallbackUrl(s2.id, false); };
    art2.src = getArtworkFallbackUrl(s2.id, s2.shiny);
  }

  if (leftTitle) leftTitle.innerText = (s1.shiny ? 'SHINY ' : '') + s1.name.toUpperCase();
  if (rightTitle) rightTitle.innerText = (s2.shiny ? 'SHINY ' : '') + s2.name.toUpperCase();
  if (leftSub) leftSub.innerText = opts.slotNum === 1 && opts.subText ? opts.subText : matchup.leftSub;
  if (rightSub) rightSub.innerText = opts.slotNum === 2 && opts.subText ? opts.subText : matchup.rightSub;
  if (headline) headline.innerText = opts.headline || ('ROUND 1 • ' + s1.name.toUpperCase() + ' VS ' + s2.name.toUpperCase());
  if (matchupBadge) matchupBadge.innerText = matchup.bannerText;

  if (statCard1) statCard1.textContent = renderPokedexStatCardHtml(s1, spec1, matchup.slot1Mult, matchup.slot2Mult);
  if (statCard2) statCard2.textContent = renderPokedexStatCardHtml(s2, spec2, matchup.slot2Mult, matchup.slot1Mult);

  initStadiumCombatants(false);

  clearTimeout(window.__cutinHoldTimer);
  clearTimeout(window.__cutinWipeoutTimer);
  clearTimeout(window.__cutinHideTimer);

  const alreadyOpen = overlay.classList.contains('active') && overlay.classList.contains('phase-hold');
  if (!alreadyOpen) {
    overlay.classList.remove(
      'active',
      'phase-wipein',
      'phase-hold',
      'phase-wipeout',
      'matchup-slot1-high',
      'matchup-slot2-high',
      'matchup-neutral'
    );
    overlay.classList.add(matchup.overlayClass);
    void overlay.offsetWidth;
    overlay.classList.add('active', 'phase-wipein');
    window.__cutinHoldTimer = setTimeout(() => {
      overlay.classList.remove('phase-wipein');
      overlay.classList.add('phase-hold');
    }, 500);
  } else {
    overlay.classList.remove('matchup-slot1-high', 'matchup-slot2-high', 'matchup-neutral');
    overlay.classList.add(matchup.overlayClass);
  }

  // Only auto-dismiss if user explicitly toggled Auto-Close: 6s ON
  if (partnerState.battleAutoClose === true) {
    window.__cutinWipeoutTimer = setTimeout(() => {
      dismissClashCutIn();
    }, 6000);
  }
}

function replayTagTeamClash() {
  pulseScreenClashAura();
  playPokemonCry(partnerState.slot1.id);
  setTimeout(() => playPokemonCry(partnerState.slot2.id), 260);
  triggerClashCutIn({
    force: true,
    headline: partnerState.slot1.name.toUpperCase() + ' VS ' + partnerState.slot2.name.toUpperCase()
  });
}

function toggleCutInFx() {
  partnerState.cutInFx = partnerState.cutInFx === false ? true : false;
  applyPartnerThemeAndHeader();
  if (partnerState.cutInFx) {
    replayTagTeamClash();
    showCommanderToast('Battle FX Stadium: ON');
  } else {
    showCommanderToast('Battle FX Stadium: OFF');
  }
}

function toggleHeroStageMode() {
  partnerState.stageMode = partnerState.stageMode === 'MINI' ? 'OPEN' : 'MINI';
  applyPartnerThemeAndHeader();
  showCommanderToast(partnerState.stageMode === 'MINI' ? 'Hero Stage minimized to Ribbon' : 'Premier Battle Stage expanded');
}

function togglePeekArtMode(ev) {
  if (ev) ev.stopPropagation();
  const active = document.body.classList.toggle('peek-art-active');
  const dot = document.getElementById('peekArtDot');
  if (dot) {
    dot.className = active
      ? 'w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#00F0FF]'
      : 'w-1.5 h-1.5 rounded-full bg-purple-400';
  }
}

function disablePeekArtMode(ev) {
  if (ev) ev.stopPropagation();
  document.body.classList.remove('peek-art-active');
  const dot = document.getElementById('peekArtDot');
  if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-purple-400';
}

async function onResetBaseClick(slotNum) {
  const key = slotNum === 1 ? 'slot1' : 'slot2';
  const current = partnerState[key];
  const resolved = await resolveFullEvolutionChain(current.id);
  const chainArr = (resolved && Array.isArray(resolved.chain) && resolved.chain.length > 0) ? resolved.chain : [current.id];
  const baseId = chainArr[0] || current.id;
  if (baseId === current.id) {
    showCommanderToast(current.name + ' is already at Base Stage 1');
    return;
  }
  const baseDex = await ensurePokemonMetadata(baseId);
  partnerState[key] = {
    id: baseDex.id,
    name: baseDex.name,
    type: baseDex.type,
    types: baseDex.types || [baseDex.type],
    stats: baseDex.stats,
    abilities: baseDex.abilities,
    shiny: Boolean(current.shiny),
    nextId: chainArr[1] || null,
    baseId,
    chain: chainArr
  };
  applyPartnerThemeAndHeader();
  playPokemonCry(baseDex.id);
  triggerClashCutIn({
    slotNum,
    subText: 'BASE STAGE 1 RESTORED • READY TO EVOLVE',
    headline: baseDex.name.toUpperCase() + ' READY FOR EVOLUTION'
  });
  showCommanderToast('Reset Slot ' + slotNum + ' to Stage 1: ' + baseDex.name);
}

function applyPartnerThemeAndHeader() {
  const s1 = hydrateSlotFromDex(partnerState.slot1);
  const s2 = hydrateSlotFromDex(partnerState.slot2);
  const spec1 = getEffectiveSlotSpectrum(s1);
  const spec2 = getEffectiveSlotSpectrum(s2);
  const matchup = getTypeMatchup(s1.types || [s1.type], s2.types || [s2.type]);

  document.documentElement.style.setProperty('--slot1-primary', spec1.hex);
  document.documentElement.style.setProperty('--slot1-primary-rgb', spec1.rgb);
  document.documentElement.style.setProperty('--slot2-primary', spec2.hex);
  document.documentElement.style.setProperty('--slot2-primary-rgb', spec2.rgb);

  document.documentElement.style.setProperty('--accent-primary', spec1.hex);
  document.documentElement.style.setProperty('--accent-primary-rgb', spec1.rgb);
  document.documentElement.style.setProperty('--accent-secondary', spec2.hex);
  document.documentElement.style.setProperty('--accent-secondary-rgb', spec2.rgb);

  // Flush Polygon Diagonal Seam Coordinates (X1% at top y=0, X2% at bottom y=100%)
  document.documentElement.style.setProperty('--clash-angle', matchup.clashAngle);
  document.documentElement.style.setProperty('--seam-x1', matchup.seamX1);
  document.documentElement.style.setProperty('--seam-x2', matchup.seamX2);

  ['ambientSeamGlow', 'ambientSeamCore', 'cutinSeamGlowLine', 'cutinSeamCoreLine'].forEach(lineId => {
    const ln = document.getElementById(lineId);
    if (ln) {
      ln.setAttribute('x1', matchup.seamX1);
      ln.setAttribute('x2', matchup.seamX2);
    }
  });

  const wm1 = document.getElementById('bgWatermarkSlot1');
  if (wm1) wm1.src = getArtworkFallbackUrl(s1.id, s1.shiny);
  const wm2 = document.getElementById('bgWatermarkSlot2');
  if (wm2) wm2.src = getArtworkFallbackUrl(s2.id, s2.shiny);

  // Stage Open / Mini Toggle
  const isMini = partnerState.stageMode === 'MINI';
  const expEl = document.getElementById('heroStageExpanded');
  const miniEl = document.getElementById('heroStageMini');
  if (expEl && miniEl) {
    if (isMini) {
      expEl.classList.add('hidden');
      miniEl.classList.remove('hidden');
      miniEl.classList.add('flex');
    } else {
      expEl.classList.remove('hidden');
      miniEl.classList.add('hidden');
      miniEl.classList.remove('flex');
    }
  }
  const stModeLbl = document.getElementById('stageModeLabel');
  const stModeDot = document.getElementById('stageModeDot');
  if (stModeLbl) stModeLbl.innerText = isMini ? 'Arena: Mini' : 'Arena: Open';
  if (stModeDot) {
    stModeDot.className = isMini
      ? 'w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_#FACC15]'
      : 'w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#00F0FF]';
  }

  const updateSlotDOM = (slotNum, slotObj, spec) => {
    const hiResImg = document.getElementById('slot' + slotNum + 'HiResArt');
    const img = document.getElementById('slot' + slotNum + 'Sprite');
    const miniImg = document.getElementById('miniSlot' + slotNum + 'Sprite');
    const nameEl = document.getElementById('slot' + slotNum + 'Name');
    const badgeEl = document.getElementById('slot' + slotNum + 'TypeBadge');
    const shinyEl = document.getElementById('slot' + slotNum + 'ShinyBadge');
    const inlineStatsEl = document.getElementById('slot' + slotNum + 'InlineStats');
    const evoBtn = document.getElementById('slot' + slotNum + 'EvolveBtn');
    const resetBtn = document.getElementById('slot' + slotNum + 'ResetBaseBtn');
    const shinyBtn = document.getElementById('slot' + slotNum + 'ShinyBtn');

    if (hiResImg) {
      hiResImg.onerror = function() {
        this.onerror = null;
        this.src = getArtworkFallbackUrl(slotObj.id, false);
      };
      hiResImg.src = getArtworkFallbackUrl(slotObj.id, slotObj.shiny);
    }
    if (img) {
      img.onerror = function() {
        this.onerror = null;
        this.src = getArtworkFallbackUrl(slotObj.id, slotObj.shiny);
      };
      img.src = getSpriteUrl(slotObj.id, slotObj.shiny);
    }
    if (miniImg) {
      miniImg.onerror = function() {
        this.onerror = null;
        this.src = getArtworkFallbackUrl(slotObj.id, slotObj.shiny);
      };
      miniImg.src = getSpriteUrl(slotObj.id, slotObj.shiny);
    }
    if (nameEl) nameEl.innerText = slotObj.name;
    if (badgeEl) {
      badgeEl.innerText = spec.label;
      badgeEl.className = 'text-[10px] font-mono-num uppercase px-2 py-0.5 rounded-md border font-extrabold whitespace-nowrap ' + spec.badgeCls;
    }
    if (shinyEl) {
      if (slotObj.shiny) shinyEl.classList.remove('hidden');
      else shinyEl.classList.add('hidden');
    }

    const dex = HALL_OF_FAME_DEX[slotObj.id] || {};
    const st = slotObj.stats || dex.stats || { hp: 85, atk: 90, def: 80, spa: 85, spd: 80, spe: 85, bst: 505 };
    if (inlineStatsEl) {
      inlineStatsEl.innerText = 'BST: ' + st.bst + ' • HP ' + st.hp + ' / ATK ' + st.atk + ' / SPD ' + st.spe;
    }

    const chainInfo = evoChainCache[slotObj.id] || HALL_OF_FAME_DEX[slotObj.id] || {};
    const chainArr = Array.isArray(slotObj.chain) && slotObj.chain.length > 0
      ? slotObj.chain
      : (Array.isArray(chainInfo.chain) ? chainInfo.chain : [slotObj.id]);
    const nextId = slotObj.nextId !== undefined ? slotObj.nextId : (chainInfo.nextId || null);
    const baseId = slotObj.baseId || chainInfo.baseId || chainArr[0] || slotObj.id;
    const isMultiStage = chainArr.length > 1;
    const stageIdx = Math.max(0, chainArr.indexOf(slotObj.id));

    if (!evoChainCache[slotObj.id] && (!Array.isArray(slotObj.chain) || slotObj.chain.length === 0)) {
      resolveFullEvolutionChain(slotObj.id).then(resolved => {
        if (resolved && Array.isArray(resolved.chain) && resolved.chain.length > 1) {
          const key = slotNum === 1 ? 'slot1' : 'slot2';
          if (partnerState[key] && partnerState[key].id === slotObj.id) {
            partnerState[key].chain = resolved.chain;
            partnerState[key].nextId = resolved.nextId;
            partnerState[key].baseId = resolved.baseId;
            applyPartnerThemeAndHeader();
          }
        }
      }).catch(() => {});
    }

    if (evoBtn) {
      if (nextId) {
        evoBtn.innerText = 'Evolve';
        evoBtn.className = 'px-2.5 py-1 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/40 text-emerald-200 border border-emerald-400/50 text-[11px] font-extrabold transition whitespace-nowrap shadow-[0_0_10px_rgba(16,185,129,0.25)]';
      } else if (isMultiStage) {
        evoBtn.innerText = 'Reset Base';
        evoBtn.className = 'px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-400/40 text-[11px] font-extrabold transition whitespace-nowrap';
      } else {
        evoBtn.innerText = 'MAX FORM';
        evoBtn.className = 'px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/35 text-[11px] font-mono-num font-extrabold transition whitespace-nowrap';
      }
    }

    if (resetBtn) {
      resetBtn.classList.remove('hidden');
      if (isMultiStage) {
        resetBtn.innerText = 'Stage ' + (stageIdx + 1) + '/' + chainArr.length;
      } else {
        resetBtn.innerText = 'Base Form';
      }
    }

    if (shinyBtn) {
      shinyBtn.innerText = slotObj.shiny ? 'Shiny: ON' : 'Shiny: OFF';
      shinyBtn.className = slotObj.shiny
        ? 'px-2.5 py-1 rounded-lg bg-amber-400/25 hover:bg-amber-400/35 text-amber-200 border border-amber-400/60 text-[11px] font-extrabold transition whitespace-nowrap shadow-[0_0_10px_rgba(250,204,21,0.3)]'
        : 'px-2.5 py-1 rounded-lg bg-white/10 hover:bg-amber-500/25 text-slate-200 hover:text-amber-200 border border-white/15 text-[11px] font-bold transition whitespace-nowrap';
    }
  };

  updateSlotDOM(1, s1, spec1);
  updateSlotDOM(2, s2, spec2);

  const centerBadge = document.getElementById('stageCenterVerdictBadge');
  if (centerBadge) {
    centerBadge.innerText = matchup.verdictShort;
  }

  const miniVerdict = document.getElementById('miniStageVerdictText');
  if (miniVerdict) {
    miniVerdict.innerText = s1.name + (s1.shiny ? ' (Shiny)' : '') + ' vs. ' + s2.name + (s2.shiny ? ' (Shiny)' : '') + ' • ' + matchup.callsignSuffix;
  }

  const callsign = document.getElementById('activeTeamCallsign');
  if (callsign) {
    callsign.innerText = s1.name + (s1.shiny ? ' (Shiny)' : '') + ' vs. ' + s2.name + (s2.shiny ? ' (Shiny)' : '') + ' • ' + matchup.callsignSuffix;
  }

  const cutState = document.getElementById('cutInFxState');
  const cutDot = document.getElementById('cutInFxDot');
  if (cutState) {
    const on = partnerState.cutInFx !== false;
    cutState.innerText = on ? 'ON' : 'OFF';
    cutState.className = on ? 'font-mono-num text-emerald-400 font-extrabold' : 'font-mono-num text-slate-400 font-extrabold';
    if (cutDot) {
      cutDot.className = on
        ? 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10B981]'
        : 'w-2 h-2 rounded-full bg-slate-500';
    }
  }

  const cryState = document.getElementById('cryAudioState');
  const cryDot = document.getElementById('cryAudioDot');
  if (cryState) {
    cryState.innerText = partnerState.cryAudio ? 'ON' : 'OFF';
    cryState.className = partnerState.cryAudio ? 'font-mono-num text-cyan-300 font-extrabold' : 'font-mono-num text-slate-400 font-extrabold';
    if (cryDot) {
      cryDot.className = partnerState.cryAudio
        ? 'w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#00F0FF]'
        : 'w-2 h-2 rounded-full bg-slate-500';
    }
  }

  const menuAutoState = document.getElementById('menuAutoCloseState');
  if (menuAutoState) {
    menuAutoState.innerText = partnerState.battleAutoClose ? '6s TIMER' : 'HOLD OPEN';
    menuAutoState.className = partnerState.battleAutoClose ? 'font-mono-num text-cyan-300 font-extrabold' : 'font-mono-num text-amber-300 font-extrabold';
  }

  const launchState = document.getElementById('autoLaunchState');
  const launchDot = document.getElementById('autoLaunchDot');
  if (launchState) {
    launchState.innerText = partnerState.autoLaunch ? 'ON' : 'OFF';
    launchState.className = partnerState.autoLaunch ? 'font-mono-num text-emerald-400 font-extrabold' : 'font-mono-num text-slate-400 font-extrabold';
    if (launchDot) {
      launchDot.className = partnerState.autoLaunch
        ? 'w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10B981]'
        : 'w-1.5 h-1.5 rounded-full bg-slate-500';
    }
  }

  savePartnerStateToStorage();
}

// Separate Evolve Handler (Advances to Next Stage or Resets Multi-Stage Chain to Base Stage 1)
async function onEvolveClick(slotNum) {
  const key = slotNum === 1 ? 'slot1' : 'slot2';
  const current = partnerState[key];
  const imgEl = document.getElementById('slot' + slotNum + 'Sprite');
  const hiResEl = document.getElementById('slot' + slotNum + 'HiResArt');
  [imgEl, hiResEl].forEach(el => {
    if (!el) return;
    el.classList.remove('evolving-sprite');
    void el.offsetWidth;
    el.classList.add('evolving-sprite');
  });
  pulseScreenClashAura();

  const resolved = await resolveFullEvolutionChain(current.id);
  const chainArr = (resolved && Array.isArray(resolved.chain) && resolved.chain.length > 0)
    ? resolved.chain
    : [current.id];
  const idx = chainArr.indexOf(current.id);
  const nextId = (idx >= 0 && idx < chainArr.length - 1) ? chainArr[idx + 1] : null;
  const baseId = chainArr[0] || current.id;

  if (nextId) {
    const nextDex = await ensurePokemonMetadata(nextId);
    const nextChainInfo = evoChainCache[nextId] || {
      chain: chainArr,
      nextId: chainArr.indexOf(nextId) < chainArr.length - 1 ? chainArr[chainArr.indexOf(nextId) + 1] : null,
      baseId
    };
    const prevName = current.name;
    partnerState[key] = {
      id: nextDex.id,
      name: nextDex.name,
      type: nextDex.type,
      types: nextDex.types || [nextDex.type],
      shiny: Boolean(current.shiny),
      nextId: nextChainInfo.nextId,
      baseId: nextChainInfo.baseId,
      chain: chainArr
    };
    applyPartnerThemeAndHeader();
    playPokemonCry(nextDex.id);
    triggerClashCutIn({
      slotNum,
      subText: 'EVOLUTION COMPLETE • STAGE ' + (chainArr.indexOf(nextId) + 1) + '/' + chainArr.length,
      headline: prevName.toUpperCase() + ' EVOLVED INTO ' + nextDex.name.toUpperCase()
    });
    showCommanderToast(prevName + ' evolved into ' + nextDex.name.toUpperCase());
  } else if (chainArr.length > 1 && baseId !== current.id) {
    const baseDex = await ensurePokemonMetadata(baseId);
    const baseChainInfo = evoChainCache[baseId] || {
      chain: chainArr,
      nextId: chainArr[1] || null,
      baseId
    };
    partnerState[key] = {
      id: baseDex.id,
      name: baseDex.name,
      type: baseDex.type,
      types: baseDex.types || [baseDex.type],
      shiny: Boolean(current.shiny),
      nextId: baseChainInfo.nextId,
      baseId: baseChainInfo.baseId,
      chain: chainArr
    };
    applyPartnerThemeAndHeader();
    playPokemonCry(baseDex.id);
    triggerClashCutIn({
      slotNum,
      subText: 'BASE STAGE RESTORED • READY TO EVOLVE',
      headline: baseDex.name.toUpperCase() + ' READY FOR EVOLUTION'
    });
    showCommanderToast('Reset evolution chain to Base Stage 1: ' + baseDex.name);
  } else {
    applyPartnerThemeAndHeader();
    playPokemonCry(current.id);
    triggerClashCutIn({
      slotNum,
      subText: 'SINGLE-STAGE APEX • MAX FORM',
      headline: current.name.toUpperCase() + ' VS ' + (slotNum === 1 ? partnerState.slot2.name.toUpperCase() : partnerState.slot1.name.toUpperCase())
    });
    showCommanderToast(current.name + ' is at MAX FORM');
  }
}

// Separate Shiny Toggle Handler (Independently toggles Shiny ON/OFF at ANY evolution stage)
function onShinyToggleClick(slotNum) {
  const key = slotNum === 1 ? 'slot1' : 'slot2';
  const current = partnerState[key];
  current.shiny = !current.shiny;

  const imgEl = document.getElementById('slot' + slotNum + 'Sprite');
  const hiResEl = document.getElementById('slot' + slotNum + 'HiResArt');
  [imgEl, hiResEl].forEach(el => {
    if (!el) return;
    el.classList.remove('evolving-sprite');
    void el.offsetWidth;
    el.classList.add('evolving-sprite');
  });

  applyPartnerThemeAndHeader();
  pulseScreenClashAura();
  playPokemonCry(current.id);
  showCommanderToast(
    current.shiny
      ? ('Shiny ' + current.name + ' palette activated')
      : ('Standard ' + current.name + ' palette restored')
  );
}

function onPartnerSpriteClick(slotNum) {
  return onEvolveClick(slotNum);
}

function renderHofRosterButtons() {
  const grid = document.getElementById('hofRosterGrid');
  if (!grid) return;
  grid.innerHTML = HOF_ROSTER_BUTTONS.map(item => {
    return (
      '<button onclick="selectHofPokemon(' + item.id + ')" class="p-1.5 rounded-xl bg-[#161229]/90 hover:bg-[#231D40] border border-white/10 hover:border-cyan-400/40 flex flex-col items-center gap-1 text-center transition">' +
        '<img src="' + getArtworkFallbackUrl(item.id, false) + '" class="w-9 h-9 object-contain" />' +
        '<span class="text-[10px] font-bold text-slate-100 leading-tight truncate w-full">' + item.label + '</span>' +
      '</button>'
    );
  }).join('');
}

function openRosterPopover(slotNum, ev) {
  if (ev) ev.stopPropagation();
  activeRosterTargetSlot = slotNum || 1;
  switchRosterTargetSlot(activeRosterTargetSlot);
  renderHofRosterButtons();

  const backdrop = document.getElementById('rosterPopoverBackdrop');
  const pop = document.getElementById('rosterPopover');
  if (!pop) return;

  // Guarantee direct child of document.body so no backdrop-filter parent traps z-index
  if (backdrop && backdrop.parentElement !== document.body) {
    document.body.appendChild(backdrop);
  }
  if (pop.parentElement !== document.body) {
    document.body.appendChild(pop);
  }

  if (backdrop) backdrop.classList.remove('hidden');
  pop.classList.remove('hidden');

  const triggerEl = (ev && ev.currentTarget)
    || document.getElementById(partnerState.stageMode === 'MINI' ? ('miniSlot' + activeRosterTargetSlot + 'SwitchBtn') : ('slot' + activeRosterTargetSlot + 'SwitchBtn'))
    || document.getElementById('premierBattleStage');

  if (triggerEl && typeof triggerEl.getBoundingClientRect === 'function') {
    const rect = triggerEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const popW = popRect.width || 460;
    const popH = popRect.height || 440;
    const vw = window.innerWidth || 1440;
    const vh = window.innerHeight || 900;

    let left = activeRosterTargetSlot === 2 ? (rect.right - popW) : rect.left;
    left = Math.max(16, Math.min(vw - popW - 16, left));

    let top = rect.bottom + 8;
    if (top + popH > vh - 16) {
      top = Math.max(64, vh - popH - 16);
    }

    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  setTimeout(() => {
    const searchInp = document.getElementById('pokeSearchInput');
    if (searchInp) {
      searchInp.focus();
      searchInp.select();
    }
  }, 30);
}

function closeRosterPopover() {
  document.getElementById('rosterPopoverBackdrop')?.classList.add('hidden');
  document.getElementById('rosterPopover')?.classList.add('hidden');
}

function switchRosterTargetSlot(slotNum) {
  activeRosterTargetSlot = slotNum;
  const ind = document.getElementById('rosterSlotIndicator');
  const b1 = document.getElementById('rosterSlot1Btn');
  const b2 = document.getElementById('rosterSlot2Btn');
  if (ind) {
    ind.innerText = slotNum === 1
      ? 'Selecting Partner for Slot 1 (Upper-Left Aura)'
      : 'Selecting Partner for Slot 2 (Lower-Right Aura)';
  }
  if (b1 && b2) {
    b1.className = slotNum === 1
      ? 'px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
      : 'px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-white/10';
    b2.className = slotNum === 2
      ? 'px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/40'
      : 'px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-white/10';
  }
}

async function selectHofPokemon(id) {
  const slotNum = activeRosterTargetSlot;
  const key = slotNum === 1 ? 'slot1' : 'slot2';
  const dex = await ensurePokemonMetadata(id);
  const chainData = await resolveFullEvolutionChain(id);
  partnerState[key] = {
    id: dex.id,
    name: dex.name,
    type: dex.type,
    types: dex.types || [dex.type],
    shiny: false,
    nextId: chainData.nextId,
    baseId: chainData.baseId,
    chain: chainData.chain
  };
  applyPartnerThemeAndHeader();
  pulseScreenClashAura();
  playPokemonCry(dex.id);
  closeRosterPopover();
  triggerClashCutIn({
    slotNum,
    headline: partnerState.slot1.name.toUpperCase() + ' VS ' + partnerState.slot2.name.toUpperCase()
  });
  showCommanderToast(dex.name + ' deployed to Slot ' + slotNum);
}

function applyTeamPreset(presetKey) {
  if (presetKey === 'GYARADOS_ARCANINE') {
    partnerState.slot1 = hydrateSlotFromDex({ id: 130, name: 'Gyarados', type: 'water', types: ['water', 'flying'], shiny: false });
    partnerState.slot2 = hydrateSlotFromDex({ id: 59,  name: 'Arcanine', type: 'fire',  types: ['fire'], shiny: false });
  } else if (presetKey === 'ABSOL_DISASTER') {
    partnerState.slot1 = hydrateSlotFromDex({ id: 359, name: 'Absol',    type: 'dark',  types: ['dark'], shiny: false });
    partnerState.slot2 = hydrateSlotFromDex({ id: 197, name: 'Umbreon',  type: 'dark',  types: ['dark'], shiny: true });
  } else if (presetKey === 'MEWTWO_CHARIZARD') {
    partnerState.slot1 = hydrateSlotFromDex({ id: 150, name: 'Mewtwo',    type: 'psychic', types: ['psychic'], shiny: false });
    partnerState.slot2 = hydrateSlotFromDex({ id: 6,   name: 'Charizard', type: 'fire',    types: ['fire', 'flying'], shiny: true });
  } else if (presetKey === 'KANTO_ORIGINALS') {
    partnerState.slot1 = hydrateSlotFromDex({ id: 7,   name: 'Squirtle',   type: 'water', types: ['water'], shiny: false });
    partnerState.slot2 = hydrateSlotFromDex({ id: 4,   name: 'Charmander', type: 'fire',  types: ['fire'], shiny: false });
  }
  applyPartnerThemeAndHeader();
  pulseScreenClashAura();
  playPokemonCry(partnerState.slot1.id);
  closeRosterPopover();
  triggerClashCutIn({
    headline: partnerState.slot1.name.toUpperCase() + ' VS ' + partnerState.slot2.name.toUpperCase()
  });
  showCommanderToast('Tag-Team Preset Activated: ' + partnerState.slot1.name + ' & ' + partnerState.slot2.name);
}

async function searchPokeApiLive() {
  const input = document.getElementById('pokeSearchInput');
  const status = document.getElementById('pokeSearchStatus');
  const q = (input?.value || '').trim().toLowerCase();
  if (!q) return;
  if (status) status.innerText = 'Fetching PokéAPI & resolving evolution chain for "' + q + '"...';
  try {
    const meta = await ensurePokemonMetadata(q);
    const chainData = await resolveFullEvolutionChain(meta.id);
    const slotNum = activeRosterTargetSlot;
    const key = slotNum === 1 ? 'slot1' : 'slot2';
    partnerState[key] = {
      id: meta.id,
      name: meta.name,
      type: meta.type,
      types: meta.types || [meta.type],
      shiny: false,
      nextId: chainData.nextId,
      baseId: chainData.baseId,
      chain: chainData.chain
    };
    applyPartnerThemeAndHeader();
    pulseScreenClashAura();
    playPokemonCry(meta.id);
    const chainSummary = chainData.chain.length > 1
      ? ('Chain (' + chainData.chain.length + ' stages) ready')
      : 'Single-stage (MAX FORM)';
    if (status) status.innerText = 'Loaded #' + meta.id + ' ' + meta.name + ' (' + meta.type.toUpperCase() + ') • ' + chainSummary;
    closeRosterPopover();
    triggerClashCutIn({
      slotNum,
      headline: partnerState.slot1.name.toUpperCase() + ' VS ' + partnerState.slot2.name.toUpperCase()
    });
    showCommanderToast('PokéAPI Loaded: #' + meta.id + ' ' + meta.name + ' (' + chainSummary + ')');
  } catch (err) {
    if (status) status.innerText = 'Could not find "' + q + '". Try name or # (1-1025).';
  }
}

function toggleAutoLaunch() {
  partnerState.autoLaunch = !partnerState.autoLaunch;
  applyPartnerThemeAndHeader();
  showCommanderToast(partnerState.autoLaunch ? 'Auto-Launch Checkout ARMED for new In-Stock drops' : 'Auto-Launch Checkout: OFF');
}

// Explicit Global Window Entrypoints for Battle Stadium & Partner Controls
function openBattleStadium(opts = {}) {
  return triggerClashCutIn({ force: true, ...opts });
}
function closeBattleStadium(ev) {
  return dismissClashCutIn(ev);
}
window.openBattleStadium = openBattleStadium;
window.closeBattleStadium = closeBattleStadium;
window.triggerClashCutIn = triggerClashCutIn;
window.dismissClashCutIn = dismissClashCutIn;
window.replayTagTeamClash = replayTagTeamClash;
window.executeStadiumMove = executeStadiumMove;
window.rollD20ForTurnAp = rollD20ForTurnAp;
window.bankRemainingApAndEndTurn = bankRemainingApAndEndTurn;
window.useTrainerItem = useTrainerItem;
window.attemptStadiumCatch = attemptStadiumCatch;
window.switchSquadMember = switchSquadMember;
window.triggerMegaOverdrive = triggerMegaOverdrive;
window.forceShinyEnemySpawn = forceShinyEnemySpawn;
window.setStadiumGameMode = setStadiumGameMode;
window.startChampionGauntlet = startChampionGauntlet;
window.toggleTrophyLocker = toggleTrophyLocker;
window.equipTrophyPokemon = equipTrophyPokemon;
window.toggleAutoSimBattle = toggleAutoSimBattle;
window.resetBattleStadiumMatch = resetBattleStadiumMatch;
window.triggerRandomStadiumBattle = triggerRandomStadiumBattle;
window.toggleStadiumSquadDrawer = toggleStadiumSquadDrawer;
window.closeStadiumSquadDrawer = closeStadiumSquadDrawer;
window.selectDrawerTeamSlot = selectDrawerTeamSlot;
window.loadBattleDeckPreset = loadBattleDeckPreset;
window.stadiumEvolvePokemon = stadiumEvolvePokemon;
window.stadiumToggleShiny = stadiumToggleShiny;
window.setStadiumDockTarget = setStadiumDockTarget;
window.tagInStadiumPokemon = tagInStadiumPokemon;
window.searchStadiumDockPokemon = searchStadiumDockPokemon;
window.toggleBattleAutoClose = toggleBattleAutoClose;
window.toggleStadiumSound = toggleStadiumSound;
