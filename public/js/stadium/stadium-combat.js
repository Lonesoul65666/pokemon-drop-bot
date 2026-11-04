/* =========================================================================
 * LOGAN'S BATTLE STADIUM — 3V3 COMBAT & D20 AP ENGINE (stadium-combat.js)
 * 3v3 Squad State, D20 Action Point (AP) Pool & Banking Rules, Turn Step
 * Tracker, AI Turn Controller, Status Effects & Stat-Weighted Damage Math.
 * Hard-Frozen in V5 Slice 2.
 * ========================================================================= */
let stadiumBattleState = {
  slot1Hp: 348,
  slot1MaxHp: 348,
  slot2Hp: 335,
  slot2MaxHp: 335,
  faintedSlot: 0,
  simRunning: false,
  simTurnSlot: 1,
  simTimer: null,
  attackLock: false
};

function buildSquadMemberFromId(pokeId, shinyFlag) {
  const dex = HALL_OF_FAME_DEX[pokeId] || HALL_OF_FAME_DEX[130];
  const member = hydrateSlotFromDex({
    id: dex.id,
    name: dex.name,
    type: dex.type,
    types: dex.types || [dex.type],
    stats: dex.stats ? { ...dex.stats } : undefined,
    abilities: dex.abilities,
    moves: dex.moves,
    shiny: Boolean(shinyFlag),
    nextId: dex.nextId || null,
    baseId: dex.baseId || dex.id,
    chain: dex.chain || [dex.id],
    megaActive: false,
    shieldActive: false,
    ailment: null,
    sleepTurns: 0,
    moveCooldowns: [0, 0, 0, 0],
    ultUnlockedByD20: false
  });
  member.maxHp = calcMaxHpForSlot(member);
  member.hp = member.maxHp;
  const mList = getFourMovesForPokemon(member);
  member.movePp = mList.map(m => Number(m.maxPp || (m.ultimate ? 5 : 15)));
  return member;
}

function loadTrophyLockerFromStorage() {
  try {
    const raw = localStorage.getItem('dropbot_v4_logan_trophy_locker');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        stadiumBattleState.trophyLocker = Array.isArray(parsed.caught) ? parsed.caught : [];
        stadiumBattleState.badges = Array.isArray(parsed.badges) ? parsed.badges : [];
        stadiumBattleState.masterBalls = typeof parsed.masterBalls === 'number' ? parsed.masterBalls : 3;
        stadiumBattleState.luckyCharmLevel = Number(parsed.luckyCharmLevel || 0);
        stadiumBattleState.megaCoreLevel = Number(parsed.megaCoreLevel || 0);
        return;
      }
    }
  } catch (e) {}
  stadiumBattleState.trophyLocker = [
    { id: 384, name: 'Rayquaza', type: 'dragon', shiny: true, bst: 680, caughtAt: 'Starter Gift' },
    { id: 6,   name: 'Charizard', type: 'fire',  shiny: false, bst: 534, caughtAt: 'Starter Gift' }
  ];
  stadiumBattleState.badges = [];
  stadiumBattleState.masterBalls = 3;
  stadiumBattleState.luckyCharmLevel = 0;
  stadiumBattleState.megaCoreLevel = 0;
}

function saveTrophyLockerToStorage() {
  try {
    localStorage.setItem('dropbot_v4_logan_trophy_locker', JSON.stringify({
      caught: stadiumBattleState.trophyLocker || [],
      badges: stadiumBattleState.badges || [],
      masterBalls: stadiumBattleState.masterBalls ?? 3,
      luckyCharmLevel: stadiumBattleState.luckyCharmLevel || 0,
      megaCoreLevel: stadiumBattleState.megaCoreLevel || 0
    }));
  } catch (e) {}
}

function awardVictoryMysteryReward(reasonLabel) {
  const rewardPool = [
    {
      key: 'MASTER_BALL',
      title: '🟣 +1 BONUS MASTER BALL UNLOCKED!',
      desc: reasonLabel + ' • Guaranteed 100% Capture Ball added to Logan\'s Vault!'
    },
    {
      key: 'LUCKY_CHARM',
      title: '🍀 LUCKY CHARM RELIC (+2 MIN D20 ROLL)!',
      desc: reasonLabel + ' • Logan\'s D20 rolls now have a permanent +2 floor boost!'
    },
    {
      key: 'MEGA_CORE',
      title: '⚡ MEGA CORE RELIC (+3 STARTING AP)!',
      desc: reasonLabel + ' • Logan starts Round 1 with +3 Bonus AP in his pool!'
    }
  ];
  const pick = rewardPool[Math.floor(Math.random() * rewardPool.length)];
  if (pick.key === 'MASTER_BALL') {
    stadiumBattleState.masterBalls = (stadiumBattleState.masterBalls ?? 3) + 1;
    if (stadiumBattleState.bag1) stadiumBattleState.bag1.balls = (stadiumBattleState.bag1.balls ?? 3) + 1;
  } else if (pick.key === 'LUCKY_CHARM') {
    stadiumBattleState.luckyCharmLevel = Math.min(3, (stadiumBattleState.luckyCharmLevel || 0) + 1);
  } else if (pick.key === 'MEGA_CORE') {
    stadiumBattleState.megaCoreLevel = Math.min(3, (stadiumBattleState.megaCoreLevel || 0) + 1);
  }
  saveTrophyLockerToStorage();

  const banner = document.getElementById('stadiumVictoryRewardBanner');
  const titleEl = document.getElementById('victoryRewardTitle');
  const descEl = document.getElementById('victoryRewardDesc');
  if (banner && titleEl && descEl) {
    titleEl.innerText = pick.title;
    descEl.innerText = pick.desc;
    banner.classList.remove('hidden');
  }
  showArcadeCombatCallout(pick.title, 'SHINY');
}

function ensureSquadTeamsInitialized() {
  if (!Array.isArray(stadiumBattleState.trophyLocker)) {
    loadTrophyLockerFromStorage();
  }
  if (!Array.isArray(stadiumBattleState.team1) || stadiumBattleState.team1.length !== 3) {
    const p1Lead = hydrateSlotFromDex({ ...partnerState.slot1 });
    p1Lead.maxHp = calcMaxHpForSlot(p1Lead);
    p1Lead.hp = p1Lead.maxHp;
    p1Lead.movePp = getFourMovesForPokemon(p1Lead).map(m => Number(m.maxPp || 15));
    p1Lead.moveCooldowns = [0, 0, 0, 0];
    p1Lead.shieldActive = false;
    p1Lead.ultUnlockedByD20 = false;
    const b1 = buildSquadMemberFromId(p1Lead.id === 384 ? 448 : 384, false);
    const b2 = buildSquadMemberFromId(p1Lead.id === 6 ? 94 : 6, false);
    stadiumBattleState.team1 = [p1Lead, b1, b2];
    stadiumBattleState.activeIdx1 = 0;
  }
  if (!Array.isArray(stadiumBattleState.team2) || stadiumBattleState.team2.length !== 3) {
    const p2Lead = hydrateSlotFromDex({ ...partnerState.slot2 });
    p2Lead.maxHp = calcMaxHpForSlot(p2Lead);
    p2Lead.hp = p2Lead.maxHp;
    p2Lead.movePp = getFourMovesForPokemon(p2Lead).map(m => Number(m.maxPp || 15));
    p2Lead.moveCooldowns = [0, 0, 0, 0];
    p2Lead.shieldActive = false;
    p2Lead.ultUnlockedByD20 = false;
    const e1 = buildSquadMemberFromId(p2Lead.id === 150 ? 445 : 150, false);
    const e2 = buildSquadMemberFromId(p2Lead.id === 149 ? 248 : 149, false);
    stadiumBattleState.team2 = [p2Lead, e1, e2];
    stadiumBattleState.activeIdx2 = 0;
  }
}

function syncActiveSquadMemberWithPartnerState(slotNum) {
  ensureSquadTeamsInitialized();
  const team = slotNum === 1 ? stadiumBattleState.team1 : stadiumBattleState.team2;
  const idx = slotNum === 1 ? (stadiumBattleState.activeIdx1 || 0) : (stadiumBattleState.activeIdx2 || 0);
  const pSlot = hydrateSlotFromDex(slotNum === 1 ? partnerState.slot1 : partnerState.slot2);
  const curMember = team[idx];

  if (!curMember || curMember.id !== pSlot.id) {
    const updated = {
      ...pSlot,
      megaActive: Boolean(pSlot.megaActive),
      shieldActive: false,
      ailment: null,
      sleepTurns: 0,
      moveCooldowns: [0, 0, 0, 0],
      ultUnlockedByD20: false
    };
    updated.maxHp = calcMaxHpForSlot(updated);
    updated.hp = updated.maxHp;
    updated.movePp = getFourMovesForPokemon(updated).map(m => Number(m.maxPp || 15));
    team[idx] = updated;
  } else {
    curMember.shiny = Boolean(pSlot.shiny);
    curMember.name = pSlot.name;
    curMember.type = pSlot.type;
    curMember.types = pSlot.types;
    curMember.stats = pSlot.stats || curMember.stats;
    if (!Array.isArray(curMember.movePp) || curMember.movePp.length !== 4) {
      curMember.movePp = getFourMovesForPokemon(curMember).map(m => Number(m.maxPp || 15));
    }
    if (!Array.isArray(curMember.moveCooldowns) || curMember.moveCooldowns.length !== 4) {
      curMember.moveCooldowns = [0, 0, 0, 0];
    }
  }
  return team[idx];
}

function stopAutoSimBattle() {
  stadiumBattleState.simRunning = false;
  clearTimeout(stadiumBattleState.simTimer);
  const btn = document.getElementById('simBattleBtn');
  if (btn) {
    btn.innerText = '[ ⚡ SIM FULL 3v3 BATTLE ]';
    btn.className = 'w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-cyan-400 to-purple-500 hover:from-cyan-300 hover:to-purple-400 text-slate-950 font-mono-num font-black text-[11px] uppercase tracking-wider shadow-[0_0_16px_rgba(0,240,255,0.35)] transition';
  }
}

function initStadiumCombatants(preserveLog) {
  stopAutoSimBattle();
  ensureSquadTeamsInitialized();
  syncActiveSquadMemberWithPartnerState(1);
  syncActiveSquadMemberWithPartnerState(2);

  [stadiumBattleState.team1, stadiumBattleState.team2].forEach(team => {
    team.forEach(m => {
      m.megaActive = false;
      m.overclock2x = false;
      m.shieldActive = false;
      m.ailment = null;
      m.sleepTurns = 0;
      m.moveCooldowns = [0, 0, 0, 0];
      m.ultUnlockedByD20 = false;
      m.maxHp = calcMaxHpForSlot(m);
      m.hp = m.maxHp;
      m.movePp = getFourMovesForPokemon(m).map(mv => Number(mv.maxPp || (mv.ultimate ? 5 : 15)));
    });
  });

  const active1 = stadiumBattleState.team1[stadiumBattleState.activeIdx1 || 0];
  const active2 = stadiumBattleState.team2[stadiumBattleState.activeIdx2 || 0];
  stadiumBattleState.slot1MaxHp = active1.maxHp;
  stadiumBattleState.slot1Hp = active1.hp;
  stadiumBattleState.slot2MaxHp = active2.maxHp;
  stadiumBattleState.slot2Hp = active2.hp;

  const startBonusAp1 = (stadiumBattleState.megaCoreLevel || 0) > 0 ? 3 : 0;
  stadiumBattleState.apPool1 = Math.min(25, 6 + startBonusAp1);
  stadiumBattleState.apPool2 = 6;
  stadiumBattleState.activeTurnSlot = 1;
  stadiumBattleState.turnRolled = false;
  stadiumBattleState.hotseatTurn = 1;

  stadiumBattleState.bag1 = {
    potions: 2,
    xAttacks: 1,
    balls: Math.max(3, Number(stadiumBattleState.masterBalls ?? 3))
  };
  stadiumBattleState.bag2 = {
    potions: 2,
    xAttacks: 1,
    balls: 3
  };

  stadiumBattleState.overdrive1 = 0;
  stadiumBattleState.overdrive2 = 0;
  stadiumBattleState.roundNumber = 1;
  stadiumBattleState.gameMode = stadiumBattleState.gameMode || 'FREE_ARENA';
  stadiumBattleState.winStreak = stadiumBattleState.winStreak || 0;
  stadiumBattleState.faintedSlot = 0;
  stadiumBattleState.attackLock = false;

  document.getElementById('stadiumVictoryRewardBanner')?.classList.add('hidden');

  const art1 = document.getElementById('cutinArtSlot1');
  const art2 = document.getElementById('cutinArtSlot2');
  if (art1) art1.classList.remove('fainted-pokemon', 'mega-overdrive-art');
  if (art2) art2.classList.remove('fainted-pokemon', 'mega-overdrive-art');

  renderStadiumCombatUI();
  renderStadiumRosterDock();

  if (active2.shiny) {
    showArcadeCombatCallout('✦ SHINY ENCOUNTER: ' + active2.name.toUpperCase() + '! ✦', 'SHINY');
  }

  if (!preserveLog) {
    const logTitle = document.getElementById('stadiumBattleLogTitle');
    const logText = document.getElementById('stadiumBattleLogText');
    if (logTitle) {
      logTitle.innerText = 'STEP 1: CLICK [ 🎲 ROLL D20 FOR AP ] TO START TURN!';
    }
    if (logText) {
      logText.innerText = active1.name.toUpperCase() + ' starts with ' + stadiumBattleState.apPool1 + ' AP! Roll the D20 to charge your AP Pool (up to 25 AP Max)!';
    }
  }
}

function switchSquadMember(sideNum, benchIdx, isAutoReplacement) {
  if (stadiumBattleState.attackLock && !isAutoReplacement) return;
  ensureSquadTeamsInitialized();
  const team = sideNum === 1 ? stadiumBattleState.team1 : stadiumBattleState.team2;
  const curIdx = sideNum === 1 ? (stadiumBattleState.activeIdx1 || 0) : (stadiumBattleState.activeIdx2 || 0);
  const targetMember = team[benchIdx];
  if (!targetMember) return;

  if (benchIdx === curIdx && !isAutoReplacement) {
    setStadiumDockTarget(sideNum);
    return;
  }
  if (targetMember.hp <= 0) {
    const logText = document.getElementById('stadiumBattleLogText');
    if (logText) logText.innerText = targetMember.name.toUpperCase() + ' has fainted! Pick a living squad member or click Full Heal Squads.';
    return;
  }

  if (sideNum === 1) stadiumBattleState.activeIdx1 = benchIdx;
  else stadiumBattleState.activeIdx2 = benchIdx;

  const key = sideNum === 1 ? 'slot1' : 'slot2';
  partnerState[key] = {
    ...partnerState[key],
    id: targetMember.id,
    name: targetMember.name,
    type: targetMember.type,
    types: targetMember.types || [targetMember.type],
    stats: targetMember.stats,
    abilities: targetMember.abilities,
    moves: targetMember.moves,
    shiny: Boolean(targetMember.shiny),
    nextId: targetMember.nextId || null,
    baseId: targetMember.baseId || targetMember.id,
    chain: targetMember.chain || [targetMember.id]
  };

  const artEl = document.getElementById('cutinArtSlot' + sideNum);
  if (artEl) {
    artEl.classList.remove('anim-switch-beam');
    void artEl.offsetWidth;
    artEl.classList.add('anim-switch-beam');
    artEl.src = getArtworkFallbackUrl(targetMember.id, targetMember.shiny);
  }

  playBattleSynthSfx('whoosh');
  playPokemonCry(targetMember.id);
  applyPartnerThemeAndHeader();

  const s1 = syncActiveSquadMemberWithPartnerState(1);
  const s2 = syncActiveSquadMemberWithPartnerState(2);
  const spec1 = getEffectiveSlotSpectrum(s1);
  const spec2 = getEffectiveSlotSpectrum(s2);
  const matchup = getTypeMatchup(s1.types || [s1.type], s2.types || [s2.type]);

  const leftTitle = document.getElementById('cutinLeftTitle');
  const rightTitle = document.getElementById('cutinRightTitle');
  const headline = document.getElementById('cutinBannerHeadline');
  const statCard1 = document.getElementById('cutinStatCardSlot1');
  const statCard2 = document.getElementById('cutinStatCardSlot2');
  if (leftTitle) leftTitle.innerText = (s1.shiny ? 'SHINY ' : '') + s1.name.toUpperCase();
  if (rightTitle) rightTitle.innerText = (s2.shiny ? 'SHINY ' : '') + s2.name.toUpperCase();
  if (headline) {
    headline.innerText = isAutoReplacement
      ? ('⚡ SENDING OUT ' + targetMember.name.toUpperCase() + '!')
      : (s1.name.toUpperCase() + ' VS ' + s2.name.toUpperCase());
  }
  if (statCard1) statCard1.textContent = renderPokedexStatCardHtml(s1, spec1, matchup.slot1Mult, matchup.slot2Mult);
  if (statCard2) statCard2.textContent = renderPokedexStatCardHtml(s2, spec2, matchup.slot2Mult, matchup.slot1Mult);

  stadiumBattleState.faintedSlot = 0;
  renderStadiumCombatUI();

  if (targetMember.shiny) {
    showArcadeCombatCallout('✦ SHINY ENCOUNTER: ' + targetMember.name.toUpperCase() + '! ✦', 'SHINY');
  }

  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');
  if (logTitle) {
    logTitle.innerText = isAutoReplacement
      ? ('⚡ SENDING OUT ' + targetMember.name.toUpperCase() + '!')
      : 'SQUAD SWITCH-IN!';
  }
  if (logText) {
    logText.innerText = 'Go, ' + targetMember.name.toUpperCase() + '! Entered the arena with ' + targetMember.hp + '/' + targetMember.maxHp + ' HP!';
  }
}

function triggerMegaOverdrive(sideNum) {
  ensureSquadTeamsInitialized();
  const member = syncActiveSquadMemberWithPartnerState(sideNum);
  const defenderSlot = sideNum === 1 ? 2 : 1;
  const defender = syncActiveSquadMemberWithPartnerState(defenderSlot);
  const odVal = sideNum === 1 ? (stadiumBattleState.overdrive1 || 0) : (stadiumBattleState.overdrive2 || 0);
  if (odVal < 100 || member.megaActive || member.hp <= 0) return;

  member.megaActive = true;
  if (sideNum === 1) stadiumBattleState.overdrive1 = 0;
  else stadiumBattleState.overdrive2 = 0;

  // Boost Max HP + Heal 30% HP + Cure Ailments + Restore PP
  const oldMax = member.maxHp;
  member.maxHp = calcMaxHpForSlot(member);
  member.hp = Math.min(member.maxHp, member.hp + Math.round((member.maxHp - oldMax) + member.maxHp * 0.30));
  member.ailment = null;
  member.movePp = getFourMovesForPokemon(member).map(m => Number(m.maxPp || (m.ultimate ? 5 : 15)));

  // Fire Massive Signature OVERDRIVE FINISHER Beam Across Screen!
  spawnElementalProjectile(sideNum, '#FACC15', true);
  const finisherDmg = Math.max(45, Math.round(defender.maxHp * 0.28));
  defender.hp = Math.max(1, defender.hp - finisherDmg);

  const floatEl = document.getElementById('dmgFloatSlot' + defenderSlot);
  if (floatEl) {
    floatEl.innerText = '-' + finisherDmg + ' HP OVERDRIVE BEAM!';
    floatEl.classList.remove('show-dmg');
    void floatEl.offsetWidth;
    floatEl.classList.add('show-dmg');
  }

  showArcadeCombatCallout('⟦ MEGA OVERDRIVE FINISHER! (+35% STATS) ⟧', 'OVERDRIVE');
  playBattleSynthSfx('victory');
  playPokemonCry(member.id);
  pulseScreenClashAura();
  renderStadiumCombatUI();

  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');
  if (logTitle) logTitle.innerText = '⟦ MEGA OVERDRIVE UNLEASHED! ⟧';
  if (logText) logText.innerText = member.name.toUpperCase() + ' unleashed MEGA OVERDRIVE! (+35% ATK/DEF, +30% HP Heal & -' + finisherDmg + ' HP Finisher Beam!)';
}

function useTrainerItem(sideNumOrItem, maybeItemType) {
  if (stadiumBattleState.attackLock) return;
  ensureSquadTeamsInitialized();
  let sideNum = 1;
  let itemType = sideNumOrItem;
  if (typeof sideNumOrItem === 'number') {
    sideNum = sideNumOrItem;
    itemType = maybeItemType;
  } else {
    sideNum = (stadiumBattleState.gameMode === 'HOTSEAT_2P' && stadiumBattleState.hotseatTurn === 2) ? 2 : (stadiumBattleState.activeTurnSlot || 1);
  }

  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');
  const activeTurn = stadiumBattleState.activeTurnSlot || 1;

  if (!stadiumBattleState.simRunning && sideNum !== activeTurn) {
    if (logTitle) logTitle.innerText = 'WAIT YOUR TURN! (SIDE ' + activeTurn + ')';
    if (logText) logText.innerText = 'Only the active player can spend AP on Trainer Bag items right now!';
    return;
  }

  if (!stadiumBattleState.turnRolled) {
    rollD20ForTurnAp(sideNum);
  }

  const fighter = syncActiveSquadMemberWithPartnerState(sideNum);
  const bag = sideNum === 1
    ? (stadiumBattleState.bag1 || (stadiumBattleState.bag1 = { potions: 2, xAttacks: 1, balls: 3 }))
    : (stadiumBattleState.bag2 || (stadiumBattleState.bag2 = { potions: 2, xAttacks: 1, balls: 3 }));
  const curAp = sideNum === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);
  const deductSideAp = (amt) => {
    if (sideNum === 1) stadiumBattleState.apPool1 = Math.max(0, (stadiumBattleState.apPool1 || 0) - amt);
    else stadiumBattleState.apPool2 = Math.max(0, (stadiumBattleState.apPool2 || 0) - amt);
  };

  if (itemType === 'POTION') {
    if ((bag.potions ?? 0) <= 0) {
      if (logTitle) logTitle.innerText = 'NO HYPER POTIONS LEFT!';
      if (logText) logText.innerText = (sideNum === 1 ? 'Logan' : 'Dad/Boss') + ' used both Hyper Potions this match!';
      return;
    }
    if (curAp < 5) {
      if (logTitle) logTitle.innerText = 'NEEDS 5 AP FOR HYPER POTION!';
      if (logText) logText.innerText = 'Roll D20 for AP or bank your remaining AP to afford Hyper Potion (5 AP)!';
      return;
    }
    deductSideAp(5);
    bag.potions = Math.max(0, (bag.potions ?? 2) - 1);
    const healAmt = Math.round(fighter.maxHp * 0.65);
    fighter.hp = Math.min(fighter.maxHp, fighter.hp + healAmt);
    fighter.ailment = null;
    playBattleSynthSfx('heal');
    const floatEl = document.getElementById('dmgFloatSlot' + sideNum);
    if (floatEl) {
      floatEl.innerText = '+' + healAmt + ' HP HYPER POTION! (-5 AP)';
      floatEl.classList.remove('show-dmg');
      void floatEl.offsetWidth;
      floatEl.classList.add('show-dmg');
    }
    renderStadiumCombatUI();
    if (logTitle) logTitle.innerText = '🧪 HYPER POTION USED! (+65% HP • -5 AP)';
    if (logText) logText.innerText = 'Restored +' + healAmt + ' HP & cured status on ' + fighter.name.toUpperCase() + '! You can keep chaining actions or Bank AP!';
  } else if (itemType === 'X_ATTACK') {
    if ((bag.xAttacks ?? 0) <= 0) {
      if (logTitle) logTitle.innerText = 'NO X-ATTACK LEFT!';
      if (logText) logText.innerText = 'X-Attack 2x DMG was already used this match!';
      return;
    }
    if (curAp < 4) {
      if (logTitle) logTitle.innerText = 'NEEDS 4 AP FOR X-ATTACK!';
      if (logText) logText.innerText = 'You need at least 4 AP to activate X-Attack 2x Damage!';
      return;
    }
    deductSideAp(4);
    bag.xAttacks = Math.max(0, (bag.xAttacks ?? 1) - 1);
    fighter.overclock2x = true;
    playBattleSynthSfx('super_effective');
    showArcadeCombatCallout('⚔️ X-ATTACK ARMED! (NEXT HIT 2.0x DMG)', 'OVERDRIVE');
    renderStadiumCombatUI();
    if (logTitle) logTitle.innerText = '⚔️ X-ATTACK 2x DMG ARMED! (-4 AP)';
    if (logText) logText.innerText = fighter.name.toUpperCase() + '\'s next attack will deal DOUBLE (2.0x) DAMAGE! Chain a move now or Bank AP!';
  } else if (itemType === 'SHIELD') {
    if (fighter.shieldActive) {
      if (logTitle) logTitle.innerText = 'ELEMENTAL SHIELD ALREADY ACTIVE!';
      if (logText) logText.innerText = fighter.name.toUpperCase() + ' already has a -50% Damage Elemental Shield raised!';
      return;
    }
    if (curAp < 4) {
      if (logTitle) logTitle.innerText = 'NEEDS 4 AP FOR ELEMENTAL SHIELD!';
      if (logText) logText.innerText = 'You need at least 4 AP to raise an Elemental Shield (-50% damage next hit)!';
      return;
    }
    deductSideAp(4);
    fighter.shieldActive = true;
    fighter.ailment = fighter.ailment || 'SHD';
    playBattleSynthSfx('heal');
    showArcadeCombatCallout('🛡️ ELEMENTAL SHIELD RAISED! (-50% DMG NEXT HIT)', 'OVERDRIVE');
    renderStadiumCombatUI();
    if (logTitle) logTitle.innerText = '🛡️ ELEMENTAL SHIELD RAISED! (-4 AP)';
    if (logText) logText.innerText = fighter.name.toUpperCase() + ' takes -50% damage from the next incoming attack!';
  }
}

function forceShinyEnemySpawn(ev) {
  if (ev) ev.stopPropagation();
  ensureSquadTeamsInitialized();
  const enemy = syncActiveSquadMemberWithPartnerState(2);
  enemy.shiny = true;
  partnerState.slot2.shiny = true;
  const art2 = document.getElementById('cutinArtSlot2');
  if (art2) art2.src = getArtworkFallbackUrl(enemy.id, true);
  const rightTitle = document.getElementById('cutinRightTitle');
  if (rightTitle) rightTitle.innerText = 'SHINY ' + enemy.name.toUpperCase();
  playBattleSynthSfx('victory');
  playPokemonCry(enemy.id);
  showArcadeCombatCallout('✦ RARE SHINY ENCOUNTER: ' + enemy.name.toUpperCase() + '! ✦', 'SHINY');
  renderStadiumCombatUI();
  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');
  if (logTitle) logTitle.innerText = '✦ SHINY ENCOUNTER TRIGGERED! ✦';
  if (logText) logText.innerText = 'A rare SHINY ' + enemy.name.toUpperCase() + ' appeared! Spend 3 AP on Capture Ball in your Trainer Bag to catch it!';
}

function setStadiumGameMode(modeKey) {
  stopAutoSimBattle();
  ensureSquadTeamsInitialized();
  stadiumBattleState.gameMode = modeKey;
  stadiumBattleState.hotseatTurn = 1;
  stadiumBattleState.activeTurnSlot = 1;
  stadiumBattleState.turnRolled = false;
  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');

  if (modeKey === 'GAUNTLET') {
    loadGauntletStage(1);
    return;
  }
  stadiumBattleState.gauntletStage = 0;
  renderStadiumCombatUI();
  if (modeKey === 'HOTSEAT_2P') {
    showArcadeCombatCallout('2P HOTSEAT: LOGAN VS DAD!', 'OVERDRIVE');
    if (logTitle) logTitle.innerText = '2P HOTSEAT • TURN: PLAYER 1 (LOGAN)';
    if (logText) logText.innerText = 'Step 1: Click [🎲 ROLL D20 FOR AP], Step 2: Spend AP on Moves/Bag, Step 3: Bank remaining AP!';
  } else {
    if (logTitle) logTitle.innerText = 'FREE ARENA (D20 AP POOL & BANKING)';
    if (logText) logText.innerText = 'Click [🎲 ROLL D20 FOR AP] to charge your AP Pool (up to 25 AP), chain moves or items, or bank AP for a Mega Finisher!';
  }
}

function rollD20ForTurnAp(forcedSide) {
  if (stadiumBattleState.attackLock) return null;
  ensureSquadTeamsInitialized();
  if (stadiumBattleState.faintedSlot !== 0) {
    resetBattleStadiumMatch();
    return null;
  }

  const activeSlot = forcedSide || stadiumBattleState.activeTurnSlot || 1;
  stadiumBattleState.activeTurnSlot = activeSlot;
  const fighter = syncActiveSquadMemberWithPartnerState(activeSlot);
  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');

  if (stadiumBattleState.turnRolled && !forcedSide) {
    if (logTitle) logTitle.innerText = 'ALREADY ROLLED D20 THIS TURN!';
    if (logText) logText.innerText = 'Spend your AP Pool on unlocked Moves or Bag items, or click [⏭️ PASS & BANK AP FOR NEXT TURN]!';
    return null;
  }

  // Tick down cooldowns by 1 turn at the start of this fighter's turn roll
  if (Array.isArray(fighter.moveCooldowns)) {
    fighter.moveCooldowns = fighter.moveCooldowns.map(c => Math.max(0, Number(c || 0) - 1));
  } else {
    fighter.moveCooldowns = [0, 0, 0, 0];
  }

  const dex = HALL_OF_FAME_DEX[fighter.id] || {};
  const st = fighter.stats || dex.stats || { atk: 90, spa: 85, spe: 85 };
  const speVal = Number(st.spe || 80);
  const speedBonus = speVal >= 105 ? 3 : (speVal >= 80 ? 2 : 1);
  const luckyMin = (activeSlot === 1 && (stadiumBattleState.luckyCharmLevel || 0) > 0)
    ? Math.min(8, 1 + (stadiumBattleState.luckyCharmLevel * 2))
    : 1;
  const rawRoll = Math.floor(Math.random() * 20) + 1;
  const natRoll = Math.max(luckyMin, rawRoll);

  let apGained = Math.min(25, natRoll + speedBonus);
  let label = '+' + apGained + ' AP ADDED TO POOL!';
  let colorCls = 'text-cyan-200 border-cyan-400/50 bg-cyan-500/20';

  if (natRoll === 20) {
    apGained = 25;
    label = 'NAT 20 BONUS! +25 AP FULL CHARGE!';
    colorCls = 'text-amber-200 border-amber-300 bg-amber-500/30 shadow-[0_0_14px_rgba(250,204,21,0.5)]';
  } else if (apGained >= 18) {
    label = 'HIGH ROLL! +' + apGained + ' AP (18 AP ULTIMATE READY!)';
    colorCls = 'text-emerald-200 border-emerald-400/60 bg-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.35)]';
  }

  const prevAp = activeSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);
  const newAp = Math.min(25, prevAp + apGained);
  if (activeSlot === 1) stadiumBattleState.apPool1 = newAp;
  else stadiumBattleState.apPool2 = newAp;

  stadiumBattleState.turnRolled = true;

  const dieEl = document.getElementById('stadium-d20-die');
  const numEl = document.getElementById('stadiumD20Number');
  const formEl = document.getElementById('stadiumD20Formula');
  const outEl = document.getElementById('stadiumD20Outcome');

  if (dieEl) {
    dieEl.classList.remove('anim-d20-roll');
    void dieEl.offsetWidth;
    dieEl.classList.add('anim-d20-roll');
  }
  if (numEl) {
    numEl.textContent = String(natRoll);
    numEl.className = 'relative z-10 text-xl font-mono-num font-black drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] ' +
      (natRoll === 20 ? 'text-amber-300' : (apGained >= 16 ? 'text-emerald-300' : 'text-white'));
  }
  if (formEl) {
    formEl.textContent = 'D20: ' + natRoll + ' (+' + speedBonus + ' Spd) -> Pool: ' + newAp + '/25 AP';
  }
  if (outEl) {
    outEl.textContent = label;
    outEl.className = 'text-[9px] font-mono-num font-black uppercase px-2 py-0.5 rounded border mt-0.5 truncate ' + colorCls;
  }

  playBattleSynthSfx(natRoll === 20 ? 'super_effective' : 'whoosh');
  if (natRoll === 20) {
    showArcadeCombatCallout('🎲 NAT 20! +25 AP FULL CHARGE!', 'CRIT');
  } else {
    showArcadeCombatCallout('🎲 ROLLED ' + natRoll + ' (+' + speedBonus + ' SPD) = ' + newAp + ' AP POOL!', 'OVERDRIVE');
  }

  renderStadiumCombatUI();

  const sideOwner = activeSlot === 1 ? 'LOGAN (P1)' : (stadiumBattleState.gameMode === 'HOTSEAT_2P' ? 'DAD (P2)' : 'OPPONENT');
  if (logTitle) logTitle.innerText = '🎲 ' + sideOwner + ' ROLLED ' + natRoll + ' -> ' + newAp + ' / 25 AP AVAILABLE!';
  if (logText) logText.innerText = 'Step 2: Click any glowing Move (5 / 9 / 12 / 18 AP) or Trainer Bag item, or click [⏭️ PASS & BANK AP] to save AP for next turn!';

  return { natRoll, speedBonus, apGained, newAp };
}

function bankRemainingApAndEndTurn() {
  if (stadiumBattleState.attackLock) return;
  ensureSquadTeamsInitialized();
  if (stadiumBattleState.faintedSlot !== 0) return;

  const curSlot = stadiumBattleState.activeTurnSlot || 1;
  const bankedAp = curSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);
  const nextSlot = curSlot === 1 ? 2 : 1;

  stadiumBattleState.activeTurnSlot = nextSlot;
  stadiumBattleState.hotseatTurn = nextSlot;
  stadiumBattleState.turnRolled = false;
  if (nextSlot === 1) {
    stadiumBattleState.roundNumber = (stadiumBattleState.roundNumber || 1) + 1;
  }

  const headline = document.getElementById('cutinBannerHeadline');
  const nextLabel = nextSlot === 1 ? 'LOGAN (P1)' : (stadiumBattleState.gameMode === 'HOTSEAT_2P' ? 'DAD (P2)' : 'BOSS AI');
  if (headline) {
    headline.innerText = 'ROUND ' + (stadiumBattleState.roundNumber || 1) + ' • TURN: ' + nextLabel;
  }

  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');
  const curLabel = curSlot === 1 ? 'Logan' : (stadiumBattleState.gameMode === 'HOTSEAT_2P' ? 'Dad' : 'Opponent');
  if (logTitle) logTitle.innerText = '⏭️ ' + curLabel.toUpperCase() + ' BANKED +' + bankedAp + ' AP! TURN -> ' + nextLabel;
  if (logText) logText.innerText = curLabel + ' carried ' + bankedAp + ' AP into next round! Now it is ' + nextLabel + '\'s turn to roll the D20 for AP!';

  renderStadiumCombatUI();

  // If playing 1P vs AI (Free Arena or Champion Gauntlet) and it's now Slot 2's turn, run AI AP Turn automatically!
  if (nextSlot === 2 && stadiumBattleState.gameMode !== 'HOTSEAT_2P' && !stadiumBattleState.simRunning) {
    setTimeout(() => {
      runAiApTurn(2);
    }, 550);
  }
}

function runAiApTurn(aiSlot = 2) {
  if (stadiumBattleState.attackLock || stadiumBattleState.faintedSlot !== 0) return;
  if ((stadiumBattleState.activeTurnSlot || 1) !== aiSlot) return;

  const aiFighter = syncActiveSquadMemberWithPartnerState(aiSlot);
  if (!stadiumBattleState.turnRolled) {
    rollD20ForTurnAp(aiSlot);
  }

  setTimeout(() => {
    if (stadiumBattleState.faintedSlot !== 0 || (stadiumBattleState.activeTurnSlot || 1) !== aiSlot) return;
    const curAp = aiSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);
    const bag = aiSlot === 1 ? stadiumBattleState.bag1 : stadiumBattleState.bag2;

    // Smart AI Bag check: if HP < 40% and has Potion + >=5 AP, pop a Hyper Potion first!
    if (aiFighter.hp > 0 && (aiFighter.hp / Math.max(1, aiFighter.maxHp)) < 0.38 && (bag?.potions || 0) > 0 && curAp >= 5) {
      useTrainerItem(aiSlot, 'POTION');
    }

    const apAfterItem = aiSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);
    const moveIdx = pickSmartMoveForAi(aiSlot, aiFighter, apAfterItem);

    if (moveIdx === -1) {
      // AI banks AP for next turn (e.g., saving for 18 AP Ultimate or <5 AP left)
      bankRemainingApAndEndTurn();
      return;
    }

    executeStadiumMove(aiSlot, moveIdx, true);
  }, 520);
}

function rollStadiumD20(attacker, defender, move) {
  const dexA = HALL_OF_FAME_DEX[attacker.id] || {};
  const dexD = HALL_OF_FAME_DEX[defender.id] || {};
  const stA = attacker.stats || dexA.stats || { atk: 90, spa: 85, spe: 80 };
  const stD = defender.stats || dexD.stats || { def: 80, spd: 80, spe: 80 };
  const offVal = move.cat === 'phys' ? Number(stA.atk || 85) : Number(stA.spa || 85);
  const defVal = move.cat === 'phys' ? Number(stD.def || 80) : Number(stD.spd || 80);
  const statBonus = Math.max(-2, Math.min(3, Math.round((offVal - defVal) / 25)));
  const natRoll = Math.floor(Math.random() * 20) + 1;
  const effectiveRoll = Math.max(1, Math.min(20, natRoll + statBonus));

  let mult = 1.0;
  let label = 'SOLID HIT (1.0x)';
  let bonusOd = 15;
  let guaranteedStatus = false;

  if (natRoll === 20) {
    mult = 1.65;
    label = 'CRITICAL STRIKE! (1.65x + STATUS!)';
    bonusOd = 30;
    guaranteedStatus = true;
  } else if (effectiveRoll <= 3) {
    mult = 0.85;
    label = 'GRAZE HIT (0.85x)';
  } else if (effectiveRoll >= 16) {
    mult = 1.25;
    label = 'SURGE HIT! (1.25x)';
    bonusOd = 20;
  }

  return { natRoll, statBonus, effectiveRoll, mult, label, bonusOd, guaranteedStatus };
}

function pickSmartMoveForAi(attackerSlot, attacker, availableAp) {
  const moves = getFourMovesForPokemon(attacker);
  if (!Array.isArray(attacker.moveCooldowns) || attacker.moveCooldowns.length !== 4) {
    attacker.moveCooldowns = [0, 0, 0, 0];
  }
  const curAp = typeof availableAp === 'number'
    ? availableAp
    : (attackerSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0));

  // 1. If AI can afford Move 4 (18 AP Ultimate Mega Finisher), unleash it immediately!
  if (curAp >= 18 && (attacker.moveCooldowns[3] || 0) <= 0) {
    return 3;
  }
  // 2. If AI has 13–17 AP and healthy HP (>55%), 45% chance to BANK AP to unleash 18 AP Ultimate next turn!
  if (curAp >= 13 && curAp < 18 && (attacker.hp / Math.max(1, attacker.maxHp)) > 0.55 && Math.random() < 0.45) {
    return -1;
  }
  // 3. Pick strongest affordable move not on cooldown (Move 3 [12 AP] -> Move 2 [9 AP] -> Move 1 [5 AP])
  const candidates = [2, 1, 0].filter(idx => {
    const cost = Number(moves[idx]?.apCost || MOVE_AP_COSTS[idx] || 5);
    const cd = Number(attacker.moveCooldowns[idx] || 0);
    return curAp >= cost && cd <= 0;
  });
  if (candidates.length > 0) {
    return candidates[0];
  }
  return -1;
}

function executeStadiumMove(attackerSlot, moveIdx, fromAiChain = false) {
  if (stadiumBattleState.attackLock) return;
  ensureSquadTeamsInitialized();
  if (stadiumBattleState.faintedSlot !== 0) {
    resetBattleStadiumMatch();
    return;
  }

  // Auto-hide the Squad & Deck Builder Drawer during active combat to eliminate clutter
  closeStadiumSquadDrawer();

  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');

  if (!stadiumBattleState.simRunning) {
    const expectedSlot = stadiumBattleState.activeTurnSlot || 1;
    if (attackerSlot !== expectedSlot) {
      if (logTitle) logTitle.innerText = 'WAIT YOUR TURN! (PLAYER ' + expectedSlot + ')';
      if (logText) logText.innerText = 'It is currently Side ' + expectedSlot + '\'s turn! Finish or Bank AP on Side ' + expectedSlot + ' first.';
      return;
    }
  }

  // If the player clicked a move before clicking [ROLL D20 FOR AP], auto-roll D20 for their turn first!
  if (!stadiumBattleState.turnRolled) {
    rollD20ForTurnAp(attackerSlot);
  }

  const defenderSlot = attackerSlot === 1 ? 2 : 1;
  const attacker = syncActiveSquadMemberWithPartnerState(attackerSlot);
  const defender = syncActiveSquadMemberWithPartnerState(defenderSlot);
  const specAtk = getEffectiveSlotSpectrum(attacker);
  const moves = getFourMovesForPokemon(attacker);
  const move = moves[moveIdx] || moves[0];
  const apCost = Number(move.apCost || MOVE_AP_COSTS[moveIdx] || 5);

  if (!Array.isArray(attacker.movePp) || attacker.movePp.length !== 4) {
    attacker.movePp = moves.map(m => Number(m.maxPp || 15));
  }
  if (!Array.isArray(attacker.moveCooldowns) || attacker.moveCooldowns.length !== 4) {
    attacker.moveCooldowns = [0, 0, 0, 0];
  }

  // Enforce Move Cooldowns
  const cdLeft = Number(attacker.moveCooldowns[moveIdx] || 0);
  if (cdLeft > 0) {
    if (logTitle) logTitle.innerText = move.name.toUpperCase() + ' ON COOLDOWN (' + cdLeft + 'T)!';
    if (logText) logText.innerText = 'Pick Move 1 (5 AP • 0 Cooldown) or another unlocked move, or Bank AP for next turn!';
    return;
  }

  // Enforce AP Pool Affordability (5 / 9 / 12 / 18 AP)
  const currentAp = attackerSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);
  if (currentAp < apCost) {
    if (logTitle) logTitle.innerText = '🔒 NEEDS ' + apCost + ' AP FOR ' + move.name.toUpperCase() + ' (HAVE ' + currentAp + ' AP)!';
    if (logText) logText.innerText = 'Click a cheaper unlocked move (Move 1 costs 5 AP) OR click [⏭️ PASS & BANK +' + currentAp + ' AP] to save up for next turn!';
    return;
  }

  // Deduct AP Cost from active player's AP Pool
  if (attackerSlot === 1) {
    stadiumBattleState.apPool1 = Math.max(0, currentAp - apCost);
  } else {
    stadiumBattleState.apPool2 = Math.max(0, currentAp - apCost);
  }

  // Check Pre-Attack Status Conditions (SLP / FRZ / PAR)
  if (attacker.ailment === 'SLP') {
    if ((attacker.sleepTurns || 0) > 0) {
      attacker.sleepTurns--;
      if (logTitle) logTitle.innerText = attacker.name.toUpperCase() + ' IS FAST ASLEEP!';
      if (logText) logText.innerText = attacker.name.toUpperCase() + ' is sleeping soundly and couldn\'t move!';
      renderStadiumCombatUI();
      return;
    } else {
      attacker.ailment = null;
    }
  } else if (attacker.ailment === 'FRZ') {
    if (move.type !== 'fire' && Math.random() > 0.38) {
      if (logTitle) logTitle.innerText = attacker.name.toUpperCase() + ' IS FROZEN SOLID!';
      if (logText) logText.innerText = attacker.name.toUpperCase() + ' is frozen in ice! Use a Fire move or Hyper Potion!';
      renderStadiumCombatUI();
      return;
    } else {
      attacker.ailment = null;
    }
  } else if (attacker.ailment === 'PAR' && Math.random() < 0.22) {
    if (logTitle) logTitle.innerText = attacker.name.toUpperCase() + ' IS PARALYZED!';
    if (logText) logText.innerText = attacker.name.toUpperCase() + ' is paralyzed and couldn\'t execute ' + move.name.toUpperCase() + '!';
    renderStadiumCombatUI();
    return;
  }

  // Apply Move Cooldown (Move 1: 0T, Move 2: 1T, Move 3: 2T, Move 4: 0T)
  const moveCd = Number(move.cooldownTurns ?? MOVE_COOLDOWN_TURNS[moveIdx] ?? 0);
  if (moveCd > 0) {
    attacker.moveCooldowns[moveIdx] = moveCd;
  }

  attacker.movePp[moveIdx] = Math.max(0, attacker.movePp[moveIdx] - 1);
  stadiumBattleState.attackLock = true;

  // If Move 4 (18 AP ULTIMATE MEGA FINISHER), trigger Mega Evolution +35% stats & full-screen orbital finisher!
  if (moveIdx === 3 && !attacker.megaActive) {
    attacker.megaActive = true;
    const oldMax = attacker.maxHp;
    attacker.maxHp = calcMaxHpForSlot(attacker);
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.max(25, attacker.maxHp - oldMax));
  }

  const d20 = rollStadiumD20(attacker, defender, move);
  const typeMult = computeMoveEffectiveness(move.type, defender.types || [defender.type]);

  if (attackerSlot === 1) {
    stadiumBattleState.overdrive1 = moveIdx === 3 ? 0 : Math.min(100, (stadiumBattleState.overdrive1 || 0) + 25);
  } else {
    stadiumBattleState.overdrive2 = moveIdx === 3 ? 0 : Math.min(100, (stadiumBattleState.overdrive2 || 0) + 25);
  }

  const atkArt = document.getElementById('cutinArtSlot' + attackerSlot);
  const defArt = document.getElementById('cutinArtSlot' + defenderSlot);
  const stageEl = document.getElementById('stadiumCombatStage');

  if (atkArt) {
    atkArt.classList.remove('anim-lunge-right', 'anim-lunge-left');
    void atkArt.offsetWidth;
    atkArt.classList.add(attackerSlot === 1 ? 'anim-lunge-right' : 'anim-lunge-left');
  }

  playBattleSynthSfx(moveIdx === 3 ? 'victory' : 'whoosh');
  playPokemonCry(attacker.id);
  if (moveIdx === 3) {
    pulseScreenClashAura();
    showArcadeCombatCallout('💥 18 AP ULTIMATE MEGA FINISHER: ' + move.name.toUpperCase() + '! (+35% MEGA STATS!)', 'OVERDRIVE');
  }
  spawnElementalProjectile(
    attackerSlot,
    (ELEMENTAL_SPECTRUM[move.type] || specAtk).hex,
    Boolean(move.ultimate || moveIdx === 3),
    moveIdx,
    move.status?.code
  );

  const dexA = HALL_OF_FAME_DEX[attacker.id] || {};
  const dexD = HALL_OF_FAME_DEX[defender.id] || {};
  const stA = attacker.stats || dexA.stats || { atk: 90, spa: 85 };
  const stD = defender.stats || dexD.stats || { def: 80, spd: 80 };

  const megaBoostA = attacker.megaActive ? 1.35 : 1.0;
  const megaBoostD = defender.megaActive ? 1.35 : 1.0;
  const overclockMult = attacker.overclock2x ? 2.0 : 1.0;
  attacker.overclock2x = false;

  // Elemental Shield reduces incoming hit by -50% and then consumes the shield!
  const hadShield = Boolean(defender.shieldActive || defender.ailment === 'SHD');
  const shieldDamageMult = hadShield ? 0.50 : 1.0;
  if (hadShield) {
    defender.shieldActive = false;
    if (defender.ailment === 'SHD') defender.ailment = null;
  }

  const brnPenalty = (attacker.ailment === 'BRN' && move.cat === 'phys') ? 0.78 : 1.0;
  const offStat = (move.cat === 'phys' ? Number(stA.atk || 85) : Number(stA.spa || 85)) * megaBoostA * brnPenalty;
  const defStat = (move.cat === 'phys' ? Number(stD.def || 80) : Number(stD.spd || 80)) * megaBoostD;
  const isCrit = d20.natRoll === 20;
  const d20Mult = d20.mult;

  const rawDmg = typeMult === 0
    ? 0
    : (((22 * Number(move.power || 90) * (offStat / Math.max(25, defStat))) / 32 + 12) * typeMult * d20Mult * overclockMult * shieldDamageMult);
  const dmg = typeMult === 0 ? 0 : Math.max(10, Math.round(rawDmg));

  setTimeout(() => {
    if (moveIdx === 3) {
      playBattleSynthSfx('super_effective');
    } else if (d20.natRoll === 20) {
      playBattleSynthSfx('super_effective');
      showArcadeCombatCallout('CRITICAL HIT! (1.65x DAMAGE!)', 'CRIT');
    } else if (typeMult > 1) {
      playBattleSynthSfx('super_effective');
      showArcadeCombatCallout('SUPER EFFECTIVE! (' + typeMult.toFixed(1) + 'x)', 'SUPER');
    } else if (typeMult < 1) {
      playBattleSynthSfx('impact');
      showArcadeCombatCallout(typeMult === 0 ? 'IMMUNE (0x)' : ('RESISTED (' + typeMult + 'x)'), 'RESIST');
    } else {
      playBattleSynthSfx('impact');
    }

    if (defArt && dmg > 0) {
      defArt.classList.remove('anim-hit-recoil');
      void defArt.offsetWidth;
      defArt.classList.add('anim-hit-recoil');
    }
    if (stageEl && dmg > 0) {
      stageEl.classList.remove('anim-arena-shake', 'anim-ultimate-shake');
      void stageEl.offsetWidth;
      stageEl.classList.add(moveIdx === 3 ? 'anim-ultimate-shake' : 'anim-arena-shake');
    }

    defender.hp = Math.max(0, defender.hp - dmg);
    let statusProcNote = hadShield ? ' [🛡️ SHIELD -50% DMG!]' : '';
    const statusChance = (moveIdx === 2 || d20.guaranteedStatus) ? 1.0 : Number(move.status?.chance || 0.35);
    if (defender.hp > 0 && (move.status || moveIdx === 2 || d20.guaranteedStatus) && !defender.ailment && Math.random() <= statusChance) {
      const code = move.status?.code || (move.type === 'fire' ? 'BRN' : (move.type === 'electric' ? 'PAR' : (move.type === 'ice' ? 'FRZ' : (move.type === 'poison' ? 'PSN' : 'PAR'))));
      if (code === 'SHD') {
        attacker.shieldActive = true;
        attacker.ailment = 'SHD';
        statusProcNote += ' [🛡️ SHIELD ACTIVE!]';
      } else {
        defender.ailment = code;
        if (code === 'SLP') defender.sleepTurns = 1 + Math.floor(Math.random() * 2);
        statusProcNote += ' [' + (STATUS_BADGE_STYLES[code]?.label || code) + '!]';
      }
    }

    let drainNote = '';
    if (move.drain && dmg > 0 && attacker.hp > 0) {
      const healAmt = Math.max(12, Math.round(dmg * Number(move.drain)));
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmt);
      drainNote = ' (+' + healAmt + ' HP DRAIN!)';
    }

    // End-of-action Burn / Poison chip damage on attacker
    let chipNote = '';
    if (attacker.hp > 0 && (attacker.ailment === 'BRN' || attacker.ailment === 'PSN')) {
      const chip = Math.max(8, Math.round(attacker.maxHp * 0.06));
      attacker.hp = Math.max(1, attacker.hp - chip);
      chipNote = ' (' + attacker.ailment + ' -' + chip + ' HP)';
    }

    const floatEl = document.getElementById('dmgFloatSlot' + defenderSlot);
    if (floatEl) {
      floatEl.innerText = (dmg === 0 ? 'IMMUNE (0 HP)' : ('-' + dmg + ' HP')) + (hadShield ? ' (SHIELDED)' : '') + ' [-' + apCost + ' AP]';
      floatEl.classList.remove('show-dmg');
      void floatEl.offsetWidth;
      floatEl.classList.add('show-dmg');
    }

    const headline = document.getElementById('cutinBannerHeadline');
    const remainingAp = attackerSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);

    renderStadiumCombatUI();

    const effNote = typeMult > 1 ? ' SUPER EFFECTIVE!' : (typeMult === 0 ? ' No effect!' : (typeMult < 1 ? ' Resisted...' : ''));

    if (defender.hp <= 0) {
      const defTeam = defenderSlot === 1 ? stadiumBattleState.team1 : stadiumBattleState.team2;
      const nextLivingIdx = defTeam.findIndex(m => m.hp > 0);

      if (nextLivingIdx !== -1) {
        const nextMonName = defTeam[nextLivingIdx].name.toUpperCase();
        showArcadeCombatCallout('⚡ SENDING OUT ' + nextMonName + '!', 'OVERDRIVE');
        if (headline) headline.innerText = '⚡ SENDING OUT ' + nextMonName + '!';
        if (logTitle) logTitle.innerText = defender.name.toUpperCase() + ' FAINTED! ⚡ SENDING OUT ' + nextMonName + '!';
        if (logText) logText.innerText = attacker.name.toUpperCase() + ' knocked out ' + defender.name.toUpperCase() + '! Bench fighter ' + nextMonName + ' enters the arena!';
        setTimeout(() => {
          stadiumBattleState.attackLock = false;
          switchSquadMember(defenderSlot, nextLivingIdx, true);
          if (attackerSlot === 2 && !stadiumBattleState.simRunning && stadiumBattleState.gameMode !== 'HOTSEAT_2P') {
            // If AI still has >=5 AP, let it finish or bank
            if ((stadiumBattleState.apPool2 || 0) >= 5) {
              setTimeout(() => runAiApTurn(2), 450);
            } else {
              bankRemainingApAndEndTurn();
            }
          }
        }, 620);
        return;
      }

      stadiumBattleState.faintedSlot = defenderSlot;
      if (attackerSlot === 1) {
        stadiumBattleState.winStreak = (stadiumBattleState.winStreak || 0) + 1;
      } else {
        stadiumBattleState.winStreak = 0;
      }
      stopAutoSimBattle();
      playBattleSynthSfx('victory');

      // Check Champion Gauntlet Progression if Player 1 wiped Boss Squad
      if (attackerSlot === 1 && stadiumBattleState.gauntletStage > 0) {
        const stageCfg = CHAMPION_GAUNTLET_STAGES[stadiumBattleState.gauntletStage - 1];
        if (stageCfg && !stadiumBattleState.badges.includes(stageCfg.badge)) {
          stadiumBattleState.badges.push(stageCfg.badge);
        }
        awardVictoryMysteryReward('GAUNTLET STAGE ' + stadiumBattleState.gauntletStage + ' CLEAR');
        if (stadiumBattleState.gauntletStage < CHAMPION_GAUNTLET_STAGES.length) {
          const nextSt = stadiumBattleState.gauntletStage + 1;
          if (headline) headline.innerText = '🏆 STAGE ' + stadiumBattleState.gauntletStage + ' CLEARED! (MYSTERY REWARD UNLOCKED)';
          if (logTitle) logTitle.innerText = 'GAUNTLET STAGE ' + stadiumBattleState.gauntletStage + ' CONQUERED!';
          if (logText) logText.innerText = 'Earned [' + stageCfg.badge + '] + Mystery Reward! Advancing to Stage ' + nextSt + ' in 2.2s...';
          setTimeout(() => {
            stadiumBattleState.attackLock = false;
            loadGauntletStage(nextSt);
          }, 2200);
          return;
        } else {
          stadiumBattleState.gauntletStage = 0;
          if (headline) headline.innerText = '🏆 GRAND CHAMPION LOGAN! ALL 5 STAGES CONQUERED!';
          if (logTitle) logTitle.innerText = '⟦ CHAMPION GAUNTLET COMPLETE! ⟧';
          if (logText) logText.innerText = 'Logan conquered all 5 Boss Squads and unlocked a Persistent Mystery Power-Up in localStorage!';
          renderStadiumCombatUI();
        }
      } else {
        if (attackerSlot === 1) {
          awardVictoryMysteryReward('3V3 VICTORY REWARD');
        }
        if (headline) headline.innerText = '🏆 WINNER: ' + attacker.name.toUpperCase() + '!';
        if (logTitle) logTitle.innerText = '3v3 SQUAD WIPEOUT VICTORY!';
        if (logText) logText.innerText = attacker.name.toUpperCase() + ' used ' + move.name.toUpperCase() + ' (-' + dmg + ' HP) to win the 3v3 match!';
        renderStadiumCombatUI();
      }
      stadiumBattleState.attackLock = false;
      return;
    }

    // Defender survived: check if active player can keep chaining AP or should Bank & End Turn!
    if (logTitle) {
      logTitle.innerText = attacker.name.toUpperCase() + ' USED ' + move.name.toUpperCase() + ' (-' + apCost + ' AP • ' + remainingAp + ' AP LEFT)!';
    }
    if (logText) {
      logText.innerText = 'Dealt -' + dmg + ' HP!' + effNote + statusProcNote + drainNote + chipNote +
        (remainingAp >= 3
          ? (' You still have ' + remainingAp + ' AP! Chain another Move/Item or click [⏭️ PASS & BANK +' + remainingAp + ' AP]!')
          : (' (' + remainingAp + ' AP left — click [⏭️ PASS & BANK +' + remainingAp + ' AP] to end turn!)'));
    }

    setTimeout(() => {
      stadiumBattleState.attackLock = false;
      renderStadiumCombatUI();

      if (stadiumBattleState.simRunning) return;

      // If AI is playing Slot 2, let AI chain another move if it can afford one, or bank remaining AP & pass turn to Logan!
      if (attackerSlot === 2 && stadiumBattleState.gameMode !== 'HOTSEAT_2P') {
        setTimeout(() => {
          if (stadiumBattleState.faintedSlot !== 0) return;
          const nextAiMove = pickSmartMoveForAi(2, attacker, stadiumBattleState.apPool2 || 0);
          if (nextAiMove !== -1) {
            executeStadiumMove(2, nextAiMove, true);
          } else {
            bankRemainingApAndEndTurn();
          }
        }, 520);
      } else if (remainingAp < 3) {
        // Auto-bank and pass turn after a brief beat if the human player has <3 AP (cannot afford any 3 AP ball, 4 AP item, or 5 AP move)
        setTimeout(() => {
          if (!stadiumBattleState.attackLock && stadiumBattleState.faintedSlot === 0 && (stadiumBattleState.activeTurnSlot || 1) === attackerSlot) {
            const curApNow = attackerSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);
            if (curApNow < 3) {
              bankRemainingApAndEndTurn();
            }
          }
        }, 650);
      }
    }, 220);
  }, 240);
}

function attemptStadiumCatch(ballType, sideNum = 1) {
  if (stadiumBattleState.attackLock) return;
  ensureSquadTeamsInitialized();
  const activeSide = sideNum === 2 ? 2 : 1;
  const targetSide = activeSide === 1 ? 2 : 1;
  const target = syncActiveSquadMemberWithPartnerState(targetSide);
  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');

  if (!stadiumBattleState.turnRolled) {
    rollD20ForTurnAp(activeSide);
  }

  const bag = activeSide === 1
    ? (stadiumBattleState.bag1 || (stadiumBattleState.bag1 = { potions: 2, xAttacks: 1, balls: 3 }))
    : (stadiumBattleState.bag2 || (stadiumBattleState.bag2 = { potions: 2, xAttacks: 1, balls: 3 }));
  const curAp = activeSide === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);

  if (curAp < 3) {
    if (logTitle) logTitle.innerText = 'NEEDS 3 AP TO THROW CAPTURE BALL!';
    if (logText) logText.innerText = 'Roll D20 for AP or bank your turn so you have at least 3 AP to throw a Capture Ball!';
    return;
  }

  if (ballType === 'MASTER') {
    if ((stadiumBattleState.masterBalls ?? 3) <= 0) {
      if (logTitle) logTitle.innerText = 'NO MASTER BALLS LEFT!';
      if (logText) logText.innerText = 'Win matches or Gauntlet stages to earn Bonus Master Balls, or throw an Ultra Ball!';
      return;
    }
    stadiumBattleState.masterBalls--;
  } else {
    if ((bag.balls ?? 3) <= 0) {
      if (logTitle) logTitle.innerText = 'NO CAPTURE BALLS LEFT IN BAG!';
      if (logText) logText.innerText = 'You used all 3 Capture Balls in your Trainer Bag this match!';
      return;
    }
    bag.balls = Math.max(0, (bag.balls ?? 3) - 1);
  }

  if (activeSide === 1) stadiumBattleState.apPool1 = Math.max(0, curAp - 3);
  else stadiumBattleState.apPool2 = Math.max(0, curAp - 3);

  const hpRatio = target.hp / Math.max(1, target.maxHp);
  let catchChance = (1.15 - hpRatio * 0.85);
  if (ballType === 'ULTRA') catchChance *= 1.85;
  if (target.ailment) catchChance += 0.20;
  if (hpRatio <= 0.35 || target.shiny) catchChance = Math.max(catchChance, 0.88);
  if (target.hp <= 0) catchChance = 0.95;
  if (ballType === 'MASTER') catchChance = 1.0;

  stadiumBattleState.attackLock = true;
  const defArt = document.getElementById('cutinArtSlot' + targetSide);
  if (defArt) {
    defArt.classList.remove('anim-switch-beam');
    void defArt.offsetWidth;
    defArt.classList.add('anim-switch-beam');
  }

  // 3-Shake Poké Ball Capture Sequence: Shake 1... Shake 2... Shake 3... GOTCHA!
  playBattleSynthSfx('catch_click');
  if (logTitle) logTitle.innerText = '🔴 THROWING ' + ballType + ' BALL (-3 AP)...';
  if (logText) logText.innerText = 'Shake 1...';

  setTimeout(() => {
    playBattleSynthSfx('catch_click');
    if (logText) logText.innerText = 'Shake 1... Shake 2...';
  }, 280);

  setTimeout(() => {
    playBattleSynthSfx('catch_click');
    if (logText) logText.innerText = 'Shake 1... Shake 2... Shake 3...';
  }, 560);

  setTimeout(() => {
    stadiumBattleState.attackLock = false;
    const success = Math.random() <= catchChance;
    if (success) {
      playBattleSynthSfx('victory');
      showArcadeCombatCallout('GOTCHA! ' + (target.shiny ? 'SHINY ' : '') + target.name.toUpperCase() + ' CAUGHT!', 'SHINY');
      const dex = HALL_OF_FAME_DEX[target.id] || {};
      const bst = Number(target.stats?.bst || dex.stats?.bst || 540);
      const existsIdx = stadiumBattleState.trophyLocker.findIndex(c => c.id === target.id && Boolean(c.shiny) === Boolean(target.shiny));
      const entry = {
        id: target.id,
        name: target.name,
        type: target.type || 'normal',
        shiny: Boolean(target.shiny),
        bst,
        caughtWith: ballType,
        caughtAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      if (existsIdx === -1) stadiumBattleState.trophyLocker.unshift(entry);
      else stadiumBattleState.trophyLocker[existsIdx] = entry;
      saveTrophyLockerToStorage();
      if (target.shiny) {
        awardVictoryMysteryReward('SHINY CAPTURE REWARD');
      }
      renderStadiumCombatUI();

      if (logTitle) logTitle.innerText = 'Shake 1... Shake 2... Shake 3... GOTCHA!';
      if (logText) logText.innerText = (target.shiny ? 'SHINY ' : '') + target.name.toUpperCase() + ' was captured and saved to Logan\'s Trophy Vault!';
    } else {
      playBattleSynthSfx('impact');
      renderStadiumCombatUI();
      if (logTitle) logTitle.innerText = 'OH NO! IT BROKE FREE!';
      if (logText) logText.innerText = target.name.toUpperCase() + ' broke out of the ' + ballType + ' BALL! Weaken its HP below 35% or inflict Sleep/Paralysis!';
    }
  }, 860);
}

async function loadGauntletStage(stageNum) {
  const cfg = CHAMPION_GAUNTLET_STAGES[stageNum - 1];
  if (!cfg) return;
  stadiumBattleState.gameMode = 'GAUNTLET';
  stadiumBattleState.gauntletStage = stageNum;
  await Promise.all(cfg.ids.map(id => ensurePokemonMetadata(id)));
  stadiumBattleState.team2 = cfg.ids.map((id, i) => buildSquadMemberFromId(id, (cfg.shinyBoss && i === 0) || Math.random() < (1 / 6)));
  stadiumBattleState.activeIdx2 = 0;
  partnerState.slot2 = { ...stadiumBattleState.team2[0] };
  applyPartnerThemeAndHeader();
  triggerClashCutIn({
    force: true,
    headline: cfg.title
  });
  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');
  if (logTitle) logTitle.innerText = cfg.title;
  if (logText) logText.innerText = 'Boss Squad: ' + stadiumBattleState.team2.map(m => (m.shiny ? 'Shiny ' : '') + m.name).join(', ') + ' — Defeat all 3 to win [' + cfg.badge + ']!';
}

function startChampionGauntlet(ev) {
  if (ev) ev.stopPropagation();
  setStadiumGameMode('GAUNTLET');
}

function toggleAutoSimBattle() {
  if (stadiumBattleState.simRunning) {
    stopAutoSimBattle();
    return;
  }
  if (stadiumBattleState.faintedSlot !== 0) {
    resetBattleStadiumMatch();
  }
  closeStadiumSquadDrawer();
  stadiumBattleState.simRunning = true;
  const btn = document.getElementById('simBattleBtn');
  if (btn) {
    btn.innerText = '⏹ Stop Auto-Sim';
    btn.className = 'w-full py-1.5 px-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-black text-[10px] uppercase tracking-wider shadow-[0_0_18px_rgba(244,63,94,0.6)] transition active:scale-95';
  }

  const stepSim = () => {
    if (!stadiumBattleState.simRunning || stadiumBattleState.faintedSlot !== 0) {
      stopAutoSimBattle();
      return;
    }
    if (stadiumBattleState.attackLock) {
      stadiumBattleState.simTimer = setTimeout(stepSim, 350);
      return;
    }
    const atkSlot = stadiumBattleState.activeTurnSlot || 1;
    if (!stadiumBattleState.turnRolled) {
      rollD20ForTurnAp(atkSlot);
      stadiumBattleState.simTimer = setTimeout(stepSim, 620);
      return;
    }
    const curFighter = syncActiveSquadMemberWithPartnerState(atkSlot);
    const curAp = atkSlot === 1 ? (stadiumBattleState.apPool1 || 0) : (stadiumBattleState.apPool2 || 0);
    const moveIdx = pickSmartMoveForAi(atkSlot, curFighter, curAp);
    if (moveIdx === -1) {
      bankRemainingApAndEndTurn();
      stadiumBattleState.simTimer = setTimeout(stepSim, 750);
      return;
    }
    executeStadiumMove(atkSlot, moveIdx, true);
    stadiumBattleState.simTimer = setTimeout(stepSim, 1050);
  };

  stepSim();
}

function resetBattleStadiumMatch() {
  const s1 = hydrateSlotFromDex(partnerState.slot1);
  const s2 = hydrateSlotFromDex(partnerState.slot2);
  const headline = document.getElementById('cutinBannerHeadline');
  if (headline) headline.innerText = 'ROUND 1 • ' + s1.name.toUpperCase() + ' VS ' + s2.name.toUpperCase();
  initStadiumCombatants(false);
}

async function triggerRandomStadiumBattle() {
  stopAutoSimBattle();
  ensureSquadTeamsInitialized();
  const logTitle = document.getElementById('stadiumBattleLogTitle');
  const logText = document.getElementById('stadiumBattleLogText');
  if (logTitle) logTitle.innerText = 'DRAFTING RANDOM 3v3 SQUADS...';
  if (logText) logText.innerText = 'Pulling 6 challengers from the 1,025 Pokédex (1-in-6 Shiny Chance!)...';

  const pickIds = () => {
    const shuffled = [...POWERHOUSE_POOL_IDS].sort(() => Math.random() - 0.5);
    return [shuffled[0], shuffled[1], Math.floor(Math.random() * 1025) + 1];
  };
  const ids1 = pickIds();
  const ids2 = pickIds();

  try {
    await Promise.all([...ids1, ...ids2].map(id => ensurePokemonMetadata(id)));
    stadiumBattleState.team1 = ids1.map(id => buildSquadMemberFromId(id, Math.random() < (1 / 6)));
    stadiumBattleState.team2 = ids2.map(id => buildSquadMemberFromId(id, Math.random() < (1 / 6)));
    stadiumBattleState.activeIdx1 = 0;
    stadiumBattleState.activeIdx2 = 0;
    partnerState.slot1 = { ...stadiumBattleState.team1[0] };
    partnerState.slot2 = { ...stadiumBattleState.team2[0] };
    applyPartnerThemeAndHeader();
    playPokemonCry(partnerState.slot1.id);
    setTimeout(() => playPokemonCry(partnerState.slot2.id), 250);
    triggerClashCutIn({
      force: true,
      headline: partnerState.slot1.name.toUpperCase() + ' VS ' + partnerState.slot2.name.toUpperCase()
    });
  } catch (e) {}
}

