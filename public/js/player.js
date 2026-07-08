document.addEventListener('DOMContentLoaded', () => {
  // Extract URL parameters if present (allows host to join as a player easily)
  const urlParams = new URLSearchParams(window.location.search);
  const qRoomCode = urlParams.get('roomCode');
  const qPlayerName = urlParams.get('playerName');
  const qPlayerAvatar = urlParams.get('avatar');

  if (qRoomCode && qPlayerName) {
    sessionStorage.setItem('uno_roomCode', qRoomCode.toUpperCase());
    sessionStorage.setItem('uno_playerName', qPlayerName);
    sessionStorage.setItem('uno_playerAvatar', qPlayerAvatar || '👑');
    sessionStorage.setItem('uno_isHost', 'false'); // Must be false for the player page!
    // Clean up URL parameters so a page refresh doesn't overwrite other things
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const roomCode = sessionStorage.getItem('uno_roomCode');
  const playerName = sessionStorage.getItem('uno_playerName');
  const playerAvatar = sessionStorage.getItem('uno_playerAvatar');
  const isHost = sessionStorage.getItem('uno_isHost') === 'true';

  if (!roomCode || !playerName || isHost) {
    alert('Session expired or invalid player state. Returning to main lobby.');
    window.location.href = '/index.html';
    return;
  }

  // Connect socket
  const socket = io();

  function renderCardContent(displaySym, extraClass, cornerFontSizeStyle = '') {
    const isImg = (typeof displaySym === 'string') && (
      displaySym.startsWith('data:image/') || 
      displaySym.startsWith('http://') || 
      displaySym.startsWith('https://') || 
      displaySym.startsWith('/') || 
      displaySym.endsWith('.png') || 
      displaySym.endsWith('.jpg') || 
      displaySym.endsWith('.jpeg') || 
      displaySym.endsWith('.webp') || 
      displaySym.endsWith('.svg')
    );

    if (isImg) {
      return `
        <span class="card-corner top" ${cornerFontSizeStyle}><img src="${displaySym}" style="width: 14px; height: 14px; object-fit: contain; border-radius: 2px;"></span>
        <div class="card-center">
          <img src="${displaySym}" style="width: 38px; height: 38px; object-fit: contain; border-radius: 4px;">
        </div>
        <span class="card-corner bottom" ${cornerFontSizeStyle}><img src="${displaySym}" style="width: 14px; height: 14px; object-fit: contain; border-radius: 2px; transform: rotate(180deg);"></span>
      `;
    }

    return `
      <span class="card-corner top" ${cornerFontSizeStyle}>${displaySym || ''}</span>
      <div class="card-center">
        <span class="card-center-val ${extraClass}">${displaySym}</span>
      </div>
      <span class="card-corner bottom" ${cornerFontSizeStyle}>${displaySym || ''}</span>
    `;
  }

  function getAvatarAnimClass(emoji) {
    const mapping = {
      '🥷': 'av-anim-ninja',
      '🧙': 'av-anim-wizard',
      '👾': 'av-anim-glitch',
      '🧙‍♀️': 'av-anim-witch',
      '👩‍🚀': 'av-anim-astro',
      '🧚‍♀️': 'av-anim-fairy',
      '🦸‍♀️': 'av-anim-hero',
      '🧜‍♀️': 'av-anim-mermaid',
      '🦊': 'av-anim-fox',
      '🐲': 'av-anim-dragon',
      '🦖': 'av-anim-dino',
      '🦄': 'av-anim-unicorn',
      '🧛‍♀️': 'av-anim-vampire',
      '🦁': 'av-anim-lion',
      '💀': 'av-anim-skull',
      '🐈‍⬛': 'av-anim-cat',
      '👑': 'av-anim-crown'
    };
    return mapping[emoji] || '';
  }

  // Elements
  const hudAvatar = document.getElementById('hudAvatar');
  const hudName = document.getElementById('hudName');
  const hudRoom = document.getElementById('hudRoom');
  const turnIndicator = document.getElementById('turnIndicator');
  const boardDiscardPreview = document.getElementById('boardDiscardPreview');
  const hudColorBadge = document.getElementById('hudColorBadge');
  const btnDrawCard = document.getElementById('btnDrawCard');
  const btnDrawStackBadge = document.getElementById('btnDrawStackBadge');
  const actionAlertBar = document.getElementById('actionAlertBar');
  const btnUno = document.getElementById('btnUno');
  const btnCallOut = document.getElementById('btnCallOut');
  const btnPlaySelected = document.getElementById('btnPlaySelected');
  const btnPassTurn = document.getElementById('btnPassTurn');
  const playerHand = document.getElementById('playerHand');
  const btnSortColor = document.getElementById('btnSortColor');
  const btnSortValue = document.getElementById('btnSortValue');
  const colorPickerOverlay = document.getElementById('colorPickerOverlay');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const gameOverStandings = document.getElementById('gameOverStandings');
  const btnExitGameOver = document.getElementById('btnExitGameOver');
  const btnPlayerRematch = document.getElementById('btnPlayerRematch');
  const opponentsList = document.getElementById('opponentsList');
  const recentPlaysFeed = document.getElementById('recentPlaysFeed');

  // Populate HUD details
  hudAvatar.innerHTML = `<span class="avatar-emoji ${getAvatarAnimClass(playerAvatar)}">${playerAvatar}</span>`;
  let displayName = playerName;
  if (playerName && playerName.endsWith(' (Host)')) {
    const baseName = playerName.substring(0, playerName.length - 7);
    displayName = baseName;

    // Add a host badge in HUD next to name
    const badge = document.createElement('span');
    badge.className = 'host-badge-tag';
    badge.innerText = 'HOST';
    badge.style.cssText = 'background: var(--clr-red); color: white; border-radius: 4px; padding: 1px 4.5px; font-size: 0.62rem; font-weight: bold; margin-left: 6px; border: 1px solid rgba(255,255,255,0.2); vertical-align: middle; line-height: 1.2;';

    hudName.innerText = displayName;
    hudName.after(badge);
  } else {
    hudName.innerText = displayName;
  }
  hudRoom.innerText = roomCode;

  let myHand = [];
  let activeSortType = null; // 'color' or 'value' or null
  let currentPlayers = [];
  let currentActivePlayerIndex = 0;
  let isMyTurn = false;
  let hasDrawnThisTurn = false;
  let activeColor = '';
  let activeValue = '';
  let activeDrawStack = 0;
  let pendingWildCardId = null;
  let selectedCards = [];
  let pendingWildCardIds = null;
  let activeHouseRules = {};
  let lastTopCardId = null;
  let lastMyTurnState = false;
  let lastMyHandCount = 0;
  let lastReceivedState = null;
  let activePlayerMessages = new Map();
  let spectatorActivePlayerIndex = 0;

  // Sound Controller
  const btnMuteSound = document.getElementById('btnMuteSound');
  if (btnMuteSound) {
    btnMuteSound.addEventListener('click', () => {
      const isMuted = window.gameSound.toggleMute();
      btnMuteSound.innerHTML = isMuted ? `
        <svg class="audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
          <line x1="23" y1="9" x2="17" y2="15"></line>
          <line x1="17" y1="9" x2="23" y2="15"></line>
        </svg>
      ` : `
        <svg class="audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
      `;
      btnMuteSound.classList.toggle('active', !isMuted);
    });
  }

  // Exit Game Controller
  const btnExitRoom = document.getElementById('btnExitRoom');
  const exitConfirmOverlay = document.getElementById('exitConfirmOverlay');
  const btnCancelExit = document.getElementById('btnCancelExit');
  const btnConfirmExit = document.getElementById('btnConfirmExit');

  if (btnExitRoom && exitConfirmOverlay) {
    btnExitRoom.addEventListener('click', () => {
      exitConfirmOverlay.classList.add('active');
    });
  }

  if (btnCancelExit && exitConfirmOverlay) {
    btnCancelExit.addEventListener('click', () => {
      exitConfirmOverlay.classList.remove('active');
    });
  }

  if (btnConfirmExit) {
    btnConfirmExit.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }

  // Re-join the room with this socket
  socket.on('connect', () => {
    console.log('Registering socket with player room session...');
    socket.emit('join_room', { roomCode, playerName, avatar: playerAvatar }, (res) => {
      if (res.status !== 'ok') {
        alert(res.message);
        window.location.href = '/index.html';
      }
    });
  });

  // Receive individualized player state
  socket.on('player_state', (state) => {
    lastReceivedState = state;
    myHand = state.hand || [];
    applyClientHandSorting();
    currentPlayers = state.players || [];
    isMyTurn = state.isMyTurn;
    activeColor = state.currentColor;
    activeValue = state.currentValue;
    activeDrawStack = state.drawStack;
    activeHouseRules = state.houseRules || {};

    // Toggle between lobby card layout and circular gameplay board layout
    const pilesHud = document.getElementById('pilesHud');
    const gameTableContainer = document.getElementById('gameTableContainer');
    
    if (state.status === 'lobby') {
      if (pilesHud) pilesHud.style.display = 'flex';
      if (gameTableContainer) gameTableContainer.style.display = 'none';
    } else {
      if (pilesHud) pilesHud.style.display = 'none';
      if (gameTableContainer) gameTableContainer.style.display = 'flex';
      
      // Render circular board elements
      currentActivePlayerIndex = state.currentPlayerIndex;
      renderRadialPlayers(state.players, currentActivePlayerIndex);
      renderDiscardPile(state.topCard);
      
      // Rotate direction indicator
      const directionIndicator = document.getElementById('directionIndicator');
      if (directionIndicator) {
        directionIndicator.className = 'direction-indicator ' + (state.direction === 1 ? 'clockwise' : 'counter-clockwise');
      }

      // Active color border glow on table center
      const tableCenter = document.querySelector('.table-center');
      if (tableCenter) {
        tableCenter.className = 'table-center ' + (state.currentColor || '');
      }

      // Update table active color indicator pill
      const tableColorIndicator = document.getElementById('tableColorIndicator');
      const tableColorName = document.getElementById('tableColorName');
      if (tableColorIndicator && tableColorName) {
        const color = state.currentColor || 'none';
        tableColorIndicator.className = 'table-color-indicator ' + color;
        tableColorName.innerText = color.toUpperCase();
      }

      // Sync active state of Draw Deck visual on table
      const drawDeckHolder = document.getElementById('drawDeckHolder');
      if (drawDeckHolder) {
        if (state.status === 'playing' && isMyTurn && !hasDrawnThisTurn) {
          drawDeckHolder.classList.remove('disabled');
        } else {
          drawDeckHolder.classList.add('disabled');
        }
      }
    }

    // 0. Sound Effects & Triggers
    if (isMyTurn && !lastMyTurnState) {
      window.gameSound.playTurnAlert();
      hasDrawnThisTurn = false; // Reset draw state on new turn
    }
    lastMyTurnState = isMyTurn;

    if (myHand.length > lastMyHandCount) {
      if (lastMyHandCount > 0) {
        window.gameSound.playDraw();
      }
    }
    lastMyHandCount = myHand.length;

    if (state.topCard && state.topCard.id !== lastTopCardId) {
      if (lastTopCardId !== null) {
        window.gameSound.playThrow();
      }
      lastTopCardId = state.topCard.id;
    } else if (!state.topCard) {
      lastTopCardId = null;
    }

    // 1. Turn HUD Indicator
    if (state.status === 'lobby') {
      turnIndicator.className = 'game-status-glow waiting';
      turnIndicator.innerText = 'LOBBY - WAIT FOR HOST';
    } else if (state.status === 'gameover') {
      turnIndicator.className = 'game-status-glow waiting';
      turnIndicator.innerText = 'GAME OVER!';
    } else {
      const me = state.players.find(p => p.name === playerName);
      if (me && me.hasWon) {
        turnIndicator.className = 'game-status-glow your-turn';
        turnIndicator.innerText = `FINISHED! RANK #${me.rank}`;
        turnIndicator.style.borderColor = 'var(--clr-yellow)';
      } else if (isMyTurn) {
        turnIndicator.className = 'game-status-glow your-turn';
        turnIndicator.innerText = 'YOUR TURN!';
        turnIndicator.style.borderColor = '';
      } else {
        const currentTurnPlayer = state.players[state.currentPlayerIndex] || { name: 'Player' };
        turnIndicator.className = 'game-status-glow waiting';
        turnIndicator.innerText = `WAITING FOR ${currentTurnPlayer.name.toUpperCase()}...`;
        turnIndicator.style.borderColor = '';
      }
    }

    // 2. Discard Pile Preview
    renderDiscardPreview(state.topCard, activeColor);

    // 3. Stacking details
    if (activeDrawStack > 0) {
      actionAlertBar.style.display = 'block';
      actionAlertBar.innerText = `⚡ Stack Active! Play +2 / +4 card or click Draw to take +${activeDrawStack} penalty.`;
      btnDrawStackBadge.style.display = 'inline-block';
      btnDrawStackBadge.innerText = `+${activeDrawStack}`;
    } else {
      actionAlertBar.style.display = 'none';
      btnDrawStackBadge.style.display = 'none';
    }

    // 4. Draw & Pass buttons accessibility
    if (state.status === 'playing' && isMyTurn && !hasDrawnThisTurn) {
      btnDrawCard.disabled = false;
    } else {
      btnDrawCard.disabled = true;
    }

    if (state.status === 'playing' && isMyTurn && hasDrawnThisTurn) {
      btnPassTurn.style.display = 'inline-block';
    } else {
      btnPassTurn.style.display = 'none';
    }

    // 5. Check if anyone can be Called Out
    // Look for other players who have exactly 1 card but haven't declared UNO
    const vulnerablePlayer = state.players.find(p => p.name !== playerName && p.cardCount === 1 && !p.unoDeclared);
    if (vulnerablePlayer && state.status === 'playing') {
      btnCallOut.style.display = 'inline-block';
      btnCallOut.innerText = `CATCH ${vulnerablePlayer.name.toUpperCase()}!`;
    } else {
      btnCallOut.style.display = 'none';
    }

    // 6. Update opponents list HUD
    if (opponentsList) {
      opponentsList.innerHTML = '';
      const otherPlayers = state.players.filter(p => p.name !== playerName);
      if (otherPlayers.length === 0) {
        opponentsList.innerHTML = `<div style="color: var(--text-secondary); text-align: center; padding-top: 24px; font-style: italic;">No opponents yet</div>`;
      } else {
        otherPlayers.forEach(p => {
          const div = document.createElement('div');
          div.style.display = 'flex';
          div.style.alignItems = 'center';
          div.style.justify = 'space-between';
          div.style.padding = '4px 6px';
          div.style.borderRadius = '4px';
          div.style.border = p.isTurn ? '1px solid #ffffff' : '1px solid transparent';
          if (p.isTurn) {
            div.style.boxShadow = '0 0 8px rgba(255,255,255,0.2)';
            div.style.background = 'rgba(255,255,255,0.05)';
          }

          let rightContent = '';
          if (p.hasWon) {
            rightContent = `<span style="color: var(--clr-yellow); font-weight: 700;">#${p.rank}</span>`;
          } else {
            rightContent = `<span class="opponent-cards-count" style="color: var(--text-secondary);">${p.cardCount}</span>`;
          }

          let nameHtml = p.name;
          if (p.name.endsWith(' (Host)')) {
            const baseName = p.name.substring(0, p.name.length - 7);
            nameHtml = `${baseName} <span class="host-badge-tag" style="background: var(--clr-red); color: white; border-radius: 3px; padding: 1px 3.5px; font-size: 0.58rem; font-weight: bold; border: 1px solid rgba(255,255,255,0.15); margin-left: 2px; display: inline-flex; align-items: center; vertical-align: middle;">HOST</span>`;
          }
          div.innerHTML = `
            <div class="opponent-name-wrapper" style="display: flex; align-items: center; gap: 4px;">
              <span><span class="avatar-emoji ${getAvatarAnimClass(p.avatar)}">${p.avatar}</span></span>
              <span style="${p.isTurn ? 'font-weight: 700; color: #fff;' : 'color: #ccc;'}; display: inline-flex; align-items: center; gap: 2px;">${nameHtml}</span>
            </div>
            ${rightContent}
          `;
          opponentsList.appendChild(div);
        });
      }
    }

    // 7. Update recent plays feed
    if (recentPlaysFeed && state.logs) {
      recentPlaysFeed.innerHTML = '';
      // Get the last 2 action logs (stripping timestamps)
      const lastLogs = state.logs.slice(-2);
      if (lastLogs.length === 0) {
        recentPlaysFeed.innerHTML = `<div style="font-style: italic; text-align: center; color: var(--text-secondary); padding-top: 4px;">No logs yet</div>`;
      } else {
        lastLogs.forEach(log => {
          const cleanLog = formatLogCompact(log);
          const logDiv = document.createElement('div');
          logDiv.innerText = cleanLog;
          logDiv.style.textOverflow = 'ellipsis';
          logDiv.style.overflow = 'hidden';
          logDiv.style.whiteSpace = 'nowrap';
          recentPlaysFeed.appendChild(logDiv);
        });
      }
    }

    // 8. Render Hand
    renderHand();
  });

  let lastHandIds = [];

  function renderMiniCard(c) {
    const sym = c.value;
    let displaySym = sym;
    if (c.type === 'action') {
      if (sym === 'skip') displaySym = '⊘';
      else if (sym === 'reverse') displaySym = '⇆';
      else if (sym === 'draw2') displaySym = '+2';
    } else if (c.type === 'wild') {
      displaySym = (sym === 'wild4') ? '+4' : ((sym === 'swap') ? '🔀' : 'W');
    }
    
    let inlineBg = '';
    if (c.type === 'custom' && c.color !== 'red' && c.color !== 'blue' && c.color !== 'green' && c.color !== 'yellow' && c.color !== 'wild') {
      inlineBg = `background-color: ${c.color};`;
    }
    
    return `
      <div class="uno-card mini-card ${c.color}" style="width: 45px; height: 70px; padding: 4px; border-radius: 4px; font-size: 8px; border: 1.5px solid #fff; flex-shrink: 0; position: relative; ${inlineBg}">
        ${renderCardContent(displaySym, '', 'style="font-size: 8px;"')}
      </div>
    `;
  }

  // Render player cards
  function renderHand() {
    playerHand.innerHTML = '';
    selectedCards = selectedCards.filter(id => myHand.some(c => c.id === id));
    updatePlayButtonHUD();

    // Check if I have finished (spectator mode)
    const meObj = currentPlayers.find(p => p.name === playerName);
    if (meObj && meObj.hasWon) {
      const activeOpponents = currentPlayers.filter(p => p.name !== playerName && !p.hasWon);
      
      let spectatorHtml = `
        <div class="spectator-view" style="width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 4px 10px;">
          <div style="font-family: var(--font-display); font-size: 0.78rem; color: var(--clr-yellow); text-transform: uppercase; text-align: center; letter-spacing: 1px; font-weight: 700; border-bottom: 1px solid var(--border-light); padding-bottom: 4px; margin-bottom: 4px;">
            👁️ Spectator Mode - Viewing Active Hands
          </div>
      `;

      if (activeOpponents.length > 0) {
        if (spectatorActivePlayerIndex >= activeOpponents.length) {
          spectatorActivePlayerIndex = 0;
        } else if (spectatorActivePlayerIndex < 0) {
          spectatorActivePlayerIndex = activeOpponents.length - 1;
        }
        
        const p = activeOpponents[spectatorActivePlayerIndex];
        const pCards = p.cards || [];
        
        let cardsHtml = '';
        if (pCards.length > 0) {
          pCards.forEach(c => {
            cardsHtml += renderMiniCard(c);
          });
        } else {
          cardsHtml = `<div style="font-size: 0.75rem; color: var(--text-secondary); font-style: italic; padding: 12px 0;">Waiting for cards...</div>`;
        }

        let nameHtml = p.name;
        if (p.name.endsWith(' (Host)')) {
          const baseName = p.name.substring(0, p.name.length - 7);
          nameHtml = `${baseName} <span class="host-badge-tag" style="background: var(--clr-red); color: white; border-radius: 3px; padding: 1px 3.5px; font-size: 0.58rem; font-weight: bold; border: 1px solid rgba(255,255,255,0.15);">HOST</span>`;
        }

        // Add nav buttons
        const isBtnDisabled = activeOpponents.length <= 1;
        const btnStyle = isBtnDisabled ? 'opacity: 0.3; cursor: not-allowed;' : '';

        spectatorHtml += `
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; font-weight: 700; font-family: var(--font-display); background: rgba(255,255,255,0.03); border: 1px solid var(--border-light); padding: 4px 10px; border-radius: 4px; margin-bottom: 4px;">
            <button class="btn btn-secondary btn-sm" id="btnSpectatorPrev" style="padding: 1px 8px; min-width: 24px; height: 22px; font-size: 0.72rem; border-color: var(--border-light); margin: 0; display: inline-flex; align-items: center; justify-content: center; ${btnStyle}" ${isBtnDisabled ? 'disabled' : ''}>&larr;</button>
            <span style="color: #fff; display: inline-flex; align-items: center; gap: 4px;">
              <span class="avatar-emoji ${getAvatarAnimClass(p.avatar)}">${p.avatar}</span> ${nameHtml} <span style="font-size: 0.72rem; font-weight: normal; color: var(--text-secondary);">(${p.cardCount} cards)</span>
            </span>
            <button class="btn btn-secondary btn-sm" id="btnSpectatorNext" style="padding: 1px 8px; min-width: 24px; height: 22px; font-size: 0.72rem; border-color: var(--border-light); margin: 0; display: inline-flex; align-items: center; justify-content: center; ${btnStyle}" ${isBtnDisabled ? 'disabled' : ''}>&rarr;</button>
          </div>
          <div class="mini-hand" style="display: flex; gap: 6px; overflow-x: auto; padding: 2px 0; min-height: 75px; justify-content: center; width: 100%;">
            ${cardsHtml}
          </div>
        `;
      } else {
        spectatorHtml += `<div style="font-size: 0.75rem; color: var(--text-secondary); font-style: italic; text-align: center; padding: 20px 0;">No active players remaining.</div>`;
      }

      spectatorHtml += `
        </div>
      `;

      playerHand.innerHTML = spectatorHtml;
      playerHand.style.flexDirection = 'column';
      playerHand.style.alignItems = 'stretch';
      playerHand.style.overflowY = 'hidden';

      // Bind nav actions
      const btnPrev = document.getElementById('btnSpectatorPrev');
      const btnNext = document.getElementById('btnSpectatorNext');
      if (btnPrev) {
        btnPrev.addEventListener('click', (e) => {
          e.stopPropagation();
          const opps = currentPlayers.filter(p => p.name !== playerName && !p.hasWon);
          if (opps.length > 0) {
            spectatorActivePlayerIndex = (spectatorActivePlayerIndex - 1 + opps.length) % opps.length;
            renderHand();
          }
        });
      }
      if (btnNext) {
        btnNext.addEventListener('click', (e) => {
          e.stopPropagation();
          const opps = currentPlayers.filter(p => p.name !== playerName && !p.hasWon);
          if (opps.length > 0) {
            spectatorActivePlayerIndex = (spectatorActivePlayerIndex + 1) % opps.length;
            renderHand();
          }
        });
      }
      return;
    }

    // Default hand rendering for active players
    playerHand.style.flexDirection = 'row';
    playerHand.style.alignItems = 'center';
    playerHand.style.overflowY = 'hidden';

    if (myHand.length === 0) {
      playerHand.innerHTML = '<div style="color: var(--text-secondary); font-style: italic; width: 100%; text-align: center; padding: 20px;">No cards in hand.</div>';
      lastHandIds = [];
      return;
    }

    myHand.forEach((c) => {
      const cardEl = document.createElement('div');
      cardEl.className = `uno-card ${c.color}`;
      
      // Card animation if newly drawn
      if (lastHandIds.length > 0 && !lastHandIds.includes(c.id)) {
        cardEl.classList.add('drawing-card');
        cardEl.style.setProperty('--deck-x', '0px');
        cardEl.style.setProperty('--deck-y', '-250px');
      }

      if (c.type === 'custom') {
        cardEl.classList.add('custom-card');
        if (c.color !== 'red' && c.color !== 'blue' && c.color !== 'green' && c.color !== 'yellow' && c.color !== 'wild') {
          cardEl.classList.add('custom-colored');
          cardEl.style.backgroundColor = c.color;
        }
      }

      const playable = isPlayable(c);
      if (playable) {
        cardEl.classList.add('playable');
      }

      if (selectedCards.includes(c.id)) {
        cardEl.classList.add('selected-to-play');
      }

      const sym = c.value;
      let displaySym = sym;
      let extraClass = '';

      if (c.type === 'action') {
        extraClass = '';
        if (sym === 'skip') displaySym = '⊘';
        else if (sym === 'reverse') displaySym = '⇆';
        else if (sym === 'draw2') displaySym = '+2';
      } else if (c.type === 'wild') {
        displaySym = (sym === 'wild4') ? '+4' : ((sym === 'swap') ? '🔀' : 'W');
        extraClass = '';
      }

      cardEl.innerHTML = `
        ${renderCardContent(displaySym, extraClass)}
        ${c.type === 'custom' ? `<div class="card-details-tooltip"><b>${c.name}</b><br>${c.description || 'Custom Card'}</div>` : ''}
      `;

      // Handle card selection play
      cardEl.addEventListener('click', () => {
        const hasDuplicates = myHand.filter(card => card.value === c.value).length > 1;

        if (hasDuplicates || selectedCards.length > 0) {
          if (!playable && selectedCards.length === 0) return; // Can't start selection with unplayable card

          if (selectedCards.length > 0) {
            const firstCard = myHand.find(card => card.id === selectedCards[0]);
            if (firstCard && c.value !== firstCard.value) {
              // Tapped different value card. Clear old selection.
              document.querySelectorAll('.uno-card').forEach(el => el.classList.remove('selected-to-play'));
              selectedCards = [];
              if (!playable) {
                updatePlayButtonHUD();
                return;
              }
            }
          }

          // Toggle selection
          const idx = selectedCards.indexOf(c.id);
          if (idx !== -1) {
            selectedCards.splice(idx, 1);
            cardEl.classList.remove('selected-to-play');
          } else {
            selectedCards.push(c.id);
            cardEl.classList.add('selected-to-play');
          }
          updatePlayButtonHUD();
        } else {
          // Standard single play
          if (!playable) return;
          
          if (c.color === 'wild' || c.color === 'wild4' || (c.type === 'custom' && c.actions.some(a => a.type === 'choose_color'))) {
            pendingWildCardId = c.id;
            pendingWildCardIds = null;
            colorPickerOverlay.classList.add('active');
          } else {
            if (c.type === 'custom' && c.actions.some(a => a.type === 'swap' && a.target === 'chosen')) {
              showPlayerPicker((targetPlayerName) => {
                socket.emit('play_card', { roomCode, cardId: c.id, targetPlayerName });
              });
            } else {
              socket.emit('play_card', { roomCode, cardId: c.id });
            }
          }
        }
      });

      playerHand.appendChild(cardEl);
    });

    // Update historical hand IDs list
    lastHandIds = myHand.map(c => c.id);
  }

  // Draw Discard Pile preview card
  function renderDiscardPreview(card, currentColor) {
    boardDiscardPreview.innerHTML = '';
    
    // Update active color hud label
    const upperColor = currentColor ? currentColor.toUpperCase() : 'NONE';
    hudColorBadge.innerText = `ACTIVE COLOR: ${upperColor}`;
    hudColorBadge.className = 'color-badge ' + (currentColor || 'none');

    if (!card) {
      boardDiscardPreview.innerHTML = `
        <div class="uno-card placeholder-card">
          <div class="card-center"><span class="card-center-val">?</span></div>
        </div>`;
      return;
    }

    const cardEl = document.createElement('div');
    cardEl.className = `uno-card ${card.color}`;
    if (card.type === 'custom') {
      cardEl.classList.add('custom-card');
      if (card.color !== 'red' && card.color !== 'blue' && card.color !== 'green' && card.color !== 'yellow' && card.color !== 'wild') {
        cardEl.classList.add('custom-colored');
        cardEl.style.backgroundColor = card.color;
      }
    }

    const sym = card.value;
    let displaySym = sym;
    let extraClass = '';

    if (card.type === 'action') {
      extraClass = '';
      if (sym === 'skip') displaySym = '⊘';
      else if (sym === 'reverse') displaySym = '⇆';
      else if (sym === 'draw2') displaySym = '+2';
    } else if (card.type === 'wild') {
      displaySym = (sym === 'wild4') ? '+4' : ((sym === 'swap') ? '🔀' : 'W');
      extraClass = '';
    }

    cardEl.innerHTML = `
      ${renderCardContent(displaySym, extraClass)}
      ${card.type === 'custom' ? `<div class="card-details-tooltip"><b>${card.name}</b><br>${card.description || 'Custom Card'}</div>` : ''}
    `;

    boardDiscardPreview.appendChild(cardEl);
  }



  // Card Playability Rule Checker (Local helper matching server checks)
  function isPlayable(card) {
    if (!isMyTurn) return false;

    // Stacking rule is active
    if (activeDrawStack > 0) {
      // If no2on4 stacking is active and the top card is wild4 (+4), we cannot play +2 (draw2)
      if (activeHouseRules.no2on4 && activeValue === 'wild4' && card.value === 'draw2') {
        return false;
      }
      if (card.value === 'draw2' || card.value === 'wild4') {
        return true;
      }
      // Check for custom cards containing drawing attributes
      if (card.type === 'custom' && card.actions && card.actions.some(a => a.type === 'draw')) {
        return true;
      }
      return false;
    }

    // Normal play verification
    if (card.color === 'wild' || card.color === 'wild4') return true;
    if (card.color === activeColor) return true;
    if (card.value === activeValue) return true;
    if (card.type === 'custom' && card.color === activeColor) return true;

    return false;
  }

  // Draw Card Click
  btnDrawCard.addEventListener('click', () => {
    if (!isMyTurn || hasDrawnThisTurn) return;
    socket.emit('draw_card', { roomCode });
    window.gameSound.playDraw();
    hasDrawnThisTurn = true;
  });

  // Pass Turn Click
  btnPassTurn.addEventListener('click', () => {
    if (!isMyTurn || !hasDrawnThisTurn) return;
    socket.emit('pass_turn', { roomCode });
    hasDrawnThisTurn = false;
    btnPassTurn.style.display = 'none';
  });

  // Declare UNO Shout click
  btnUno.addEventListener('click', () => {
    socket.emit('declare_uno', { roomCode });
    // Visual flash confirmation for the user
    btnUno.style.transform = 'scale(0.95)';
    setTimeout(() => btnUno.style.transform = 'none', 100);
  });

  // Call out click
  btnCallOut.addEventListener('click', () => {
    socket.emit('call_out_uno', { roomCode });
  });

  btnSortColor.addEventListener('click', () => {
    if (activeSortType === 'color') {
      activeSortType = null;
      btnSortColor.style.borderColor = 'rgba(255,255,255,0.1)';
      btnSortColor.style.background = 'rgba(255,255,255,0.03)';
    } else {
      activeSortType = 'color';
      btnSortColor.style.borderColor = '#ffffff';
      btnSortColor.style.background = 'rgba(255,255,255,0.15)';
      
      btnSortValue.style.borderColor = 'rgba(255,255,255,0.1)';
      btnSortValue.style.background = 'rgba(255,255,255,0.03)';
    }
    applyClientHandSorting();
    renderHand();
  });

  btnSortValue.addEventListener('click', () => {
    if (activeSortType === 'value') {
      activeSortType = null;
      btnSortValue.style.borderColor = 'rgba(255,255,255,0.1)';
      btnSortValue.style.background = 'rgba(255,255,255,0.03)';
    } else {
      activeSortType = 'value';
      btnSortValue.style.borderColor = '#ffffff';
      btnSortValue.style.background = 'rgba(255,255,255,0.15)';
      
      btnSortColor.style.borderColor = 'rgba(255,255,255,0.1)';
      btnSortColor.style.background = 'rgba(255,255,255,0.03)';
    }
    applyClientHandSorting();
    renderHand();
  });

  // Play Selected Cards click handler
  btnPlaySelected.addEventListener('click', () => {
    if (selectedCards.length === 0) return;

    const hasWild = selectedCards.some(id => {
      const c = myHand.find(card => card.id === id);
      if (!c) return false;
      return c.color === 'wild' || c.color === 'wild4' || (c.type === 'custom' && c.actions && c.actions.some(a => a.type === 'choose_color'));
    });

    const hasSwapChosen = selectedCards.some(id => {
      const c = myHand.find(card => card.id === id);
      if (!c) return false;
      return (c.type === 'custom' && c.actions && c.actions.some(a => a.type === 'swap' && a.target === 'chosen'))
          || (c.type === 'wild' && c.value === 'swap');
    });

    if (hasWild) {
      pendingWildCardIds = [...selectedCards];
      pendingWildCardId = null;
      colorPickerOverlay.classList.add('active');
    } else if (hasSwapChosen) {
      showPlayerPicker((targetPlayerName) => {
        socket.emit('play_card', {
          roomCode,
          cardIds: selectedCards,
          targetPlayerName
        });
        selectedCards = [];
        updatePlayButtonHUD();
      });
    } else {
      socket.emit('play_card', {
        roomCode,
        cardIds: selectedCards
      });
      selectedCards = [];
      updatePlayButtonHUD();
    }
  });

  function updatePlayButtonHUD() {
    if (selectedCards.length === 0) {
      btnPlaySelected.style.display = 'none';
    } else {
      btnPlaySelected.style.display = 'inline-block';
      if (selectedCards.length === 1) {
        btnPlaySelected.innerText = 'Throw Card';
      } else if (selectedCards.length === 2) {
        btnPlaySelected.innerText = 'Throw Pair';
      } else if (selectedCards.length === 3) {
        btnPlaySelected.innerText = 'Throw Triple';
      } else {
        btnPlaySelected.innerText = `Throw ${selectedCards.length} Cards`;
      }
    }
  }

  // Color picker events
  document.querySelectorAll('.color-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const chosenColor = btn.getAttribute('data-color');
      if (pendingWildCardId) {
        const c = myHand.find(card => card.id === pendingWildCardId);
        const hasSwapChosen = (c && c.type === 'custom' && c.actions && c.actions.some(a => a.type === 'swap' && a.target === 'chosen'))
                            || (c && c.type === 'wild' && c.value === 'swap');
        
        colorPickerOverlay.classList.remove('active');
        if (hasSwapChosen) {
          showPlayerPicker((targetPlayerName) => {
            socket.emit('play_card', {
              roomCode,
              cardId: pendingWildCardId,
              chosenColor: chosenColor,
              targetPlayerName: targetPlayerName
            });
            pendingWildCardId = null;
          });
        } else {
          socket.emit('play_card', {
            roomCode,
            cardId: pendingWildCardId,
            chosenColor: chosenColor
          });
          pendingWildCardId = null;
        }
      } else if (pendingWildCardIds && pendingWildCardIds.length > 0) {
        const c = myHand.find(card => card.id === pendingWildCardIds[0]);
        const hasSwapChosen = (c && c.type === 'custom' && c.actions && c.actions.some(a => a.type === 'swap' && a.target === 'chosen'))
                            || (c && c.type === 'wild' && c.value === 'swap');
        
        colorPickerOverlay.classList.remove('active');
        if (hasSwapChosen) {
          showPlayerPicker((targetPlayerName) => {
            socket.emit('play_card', {
              roomCode,
              cardIds: pendingWildCardIds,
              chosenColor: chosenColor,
              targetPlayerName: targetPlayerName
            });
            pendingWildCardIds = null;
            selectedCards = [];
            updatePlayButtonHUD();
          });
        } else {
          socket.emit('play_card', {
            roomCode,
            cardIds: pendingWildCardIds,
            chosenColor: chosenColor
          });
          pendingWildCardIds = null;
          selectedCards = [];
          updatePlayButtonHUD();
        }
      }
    });
  });

  // Chat Overlay Event Listeners
  const btnChat = document.getElementById('btnChat');
  const chatOverlay = document.getElementById('chatOverlay');
  const btnCloseChat = document.getElementById('btnCloseChat');

  if (btnChat && chatOverlay && btnCloseChat) {
    btnChat.addEventListener('click', () => {
      chatOverlay.classList.add('active');
    });

    btnCloseChat.addEventListener('click', () => {
      chatOverlay.classList.remove('active');
    });

    // Handle emoji clicks
    chatOverlay.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        socket.emit('player_message', { roomCode, message: emoji, isEmoji: true });
        chatOverlay.classList.remove('active');
      });
    });

    // Handle phrase clicks
    chatOverlay.querySelectorAll('.phrase-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const phrase = btn.getAttribute('data-phrase');
        socket.emit('player_message', { roomCode, message: phrase, isEmoji: false });
        chatOverlay.classList.remove('active');
      });
    });
  }

  // Dismiss game over overlay when clicked
  if (btnExitGameOver) {
    btnExitGameOver.addEventListener('click', () => {
      gameOverOverlay.classList.remove('active');
    });
  }

  // Rematch Button event binding
  if (btnPlayerRematch) {
    btnPlayerRematch.addEventListener('click', () => {
      socket.emit('rematch', { roomCode });
    });
  }

  // Listen for rematch start
  socket.on('rematch_started', () => {
    gameOverOverlay.classList.remove('active');
  });

  // Handle game over announcement and standings
  socket.on('game_over_announcement', (data) => {
    gameOverStandings.innerHTML = '';
    
    if (data.standings) {
      data.standings.forEach(s => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justify = 'space-between';
        row.style.borderBottom = '1px dashed #222';
        row.style.paddingBottom = '4px';
        row.style.fontSize = '0.9rem';
        if (s.name === playerName) {
          row.style.color = 'var(--clr-yellow)';
          row.style.fontWeight = '700';
        }
        
        row.innerHTML = `
          <span>Rank #${s.rank}</span>
          <span>${s.name} ${s.name === playerName ? '(You)' : ''}</span>
        `;
        gameOverStandings.appendChild(row);
      });
    } else {
      gameOverStandings.innerHTML = `<div style="text-align: center;">Winner: ${data.winner}</div>`;
    }
    
    gameOverOverlay.classList.add('active');
  });

  function refreshPlayers() {
    if (lastReceivedState) {
      renderRadialPlayers(lastReceivedState.players, lastReceivedState.currentPlayerIndex);
    }
  }

  // Chat message listener
  socket.on('player_message_received', (data) => {
    if (window.gameSound && typeof window.gameSound.playChatNotification === 'function') {
      window.gameSound.playChatNotification();
    }

    // Cancel existing timeout for this player
    const existing = activePlayerMessages.get(data.name);
    if (existing && existing.timeoutId) {
      clearTimeout(existing.timeoutId);
    }

    // Set a timeout to clear the message after 3.5 seconds
    const timeoutId = setTimeout(() => {
      activePlayerMessages.delete(data.name);
      refreshPlayers();
    }, 3500);

    // Save message info
    activePlayerMessages.set(data.name, {
      message: data.message,
      isEmoji: data.isEmoji,
      timeoutId: timeoutId
    });

    // Refresh players view
    refreshPlayers();
  });

  // Catch notification events from room
  socket.on('uno_notification', (data) => {
    window.gameSound.playUnoFanfare();
  });

  socket.on('error_message', (msg) => {
    alert(msg);
  });

  socket.on('room_closed', (msg) => {
    alert(msg);
    window.location.href = '/index.html';
  });

  socket.on('banned', (data) => {
    alert(data.message || 'You have been banned from this server.');
    window.location.href = '/index.html';
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'banned') {
      alert('You are banned from this server.');
      window.location.href = '/index.html';
    }
  });

  // Compact log formatter to show Name: Action (Color & Num)
  function formatLogCompact(logStr) {
    let msg = logStr.replace(/^\[\d{2}:\d{2}:\d{2}(?:\s*[APM]{2})?\]\s*/i, '').trim();

    if (msg.includes('played a MULTIPLE of same value:')) {
      const parts = msg.split('played a MULTIPLE of same value:');
      const name = parts[0].trim();
      const cards = parts[1].replace(/\.$/, '').trim();
      return `${name}: ${cards}`;
    }
    if (msg.startsWith('⚡ Jump-In!')) {
      const match = msg.match(/⚡ Jump-In!\s+(.+?)\s+played/);
      if (match) return `${match[1].trim()}: Jump-In`;
    }
    if (msg.includes(' played ') && !msg.includes('played out of turn')) {
      const parts = msg.split(' played ');
      const name = parts[0].trim();
      const cardInfo = parts[1].replace(/\.$/, '').trim();
      return `${name}: ${cardInfo}`;
    }
    if (msg.includes(' drew ')) {
      const parts = msg.split(' drew ');
      const name = parts[0].trim();
      if (msg.includes('penalty')) {
        const match = msg.match(/penalty of (\d+)/);
        return `${name}: Drew +${match ? match[1] : ''}`;
      }
      return `${name}: Drew`;
    }
    if (msg.includes(' passed their turn')) {
      const name = msg.split(' passed ')[0].trim();
      return `${name}: Pass`;
    }
    if (msg.includes('shouted UNO')) {
      const name = msg.replace('📣', '').split(' shouted ')[0].trim();
      return `${name}: UNO`;
    }
    if (msg.includes('went offline')) {
      const name = msg.split(' went offline')[0].trim();
      return `${name}: Offline`;
    }
    if (msg.includes('reconnected')) {
      const name = msg.replace('Player ', '').split(' reconnected')[0].trim();
      return `${name}: Reconnect`;
    }
    return msg;
  }

  function showPlayerPicker(onSelect) {
    const playerPickerOverlay = document.getElementById('playerPickerOverlay');
    const playerPickerGrid = document.getElementById('playerPickerGrid');
    
    playerPickerGrid.innerHTML = '';
    
    // Opponents who haven't won yet
    const opponents = currentPlayers.filter(p => p.name !== playerName && !p.hasWon);
    
    if (opponents.length === 0) {
      onSelect(null);
      return;
    }
    
    opponents.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.width = '100%';
      btn.style.justifyContent = 'center';
      btn.style.fontSize = '0.9rem';
      btn.style.padding = '8px';
      btn.innerHTML = `<span style="margin-right: 8px;">${p.avatar}</span> <b>${p.name}</b> (${p.cardCount} cards)`;
      btn.addEventListener('click', () => {
        playerPickerOverlay.classList.remove('active');
        onSelect(p.name);
      });
      playerPickerGrid.appendChild(btn);
    });
    
    playerPickerOverlay.classList.add('active');
  }

  // Draw pile on circular table click triggers btnDrawCard click
  const drawDeckHolder = document.getElementById('drawDeckHolder');
  if (drawDeckHolder) {
    drawDeckHolder.addEventListener('click', () => {
      if (!btnDrawCard.disabled) {
        btnDrawCard.click();
      }
    });
  }

  // State tracker for top card
  let currentTopCard = null;

  // Render discard pile with stacked/tilted visual on circular table
  function renderDiscardPile(topCard) {
    const discardStack = document.getElementById('discardStack');
    if (!discardStack) return;

    if (!topCard) {
      discardStack.innerHTML = '';
      currentTopCard = null;
      return;
    }

    if (currentTopCard && currentTopCard.id === topCard.id) {
      return;
    }

    currentTopCard = topCard;
    discardStack.innerHTML = '';

    // Render 1 dummy card underneath for a subtle 3D stack depth effect
    const dummyEl = document.createElement('div');
    dummyEl.className = 'uno-card red';
    dummyEl.style.transform = 'translate(-2px, -3px) rotate(-6deg)';
    dummyEl.style.opacity = '0.4';
    dummyEl.style.pointerEvents = 'none';
    dummyEl.innerHTML = '<div class="card-center"></div>';
    discardStack.appendChild(dummyEl);

    // Render the actual top card with throw animation from bottom
    const cardEl = document.createElement('div');
    cardEl.className = `uno-card ${topCard.color} thrown-card`;
    if (topCard.type === 'custom') {
      cardEl.classList.add('custom-card');
      if (topCard.color !== 'red' && topCard.color !== 'blue' && topCard.color !== 'green' && topCard.color !== 'yellow' && topCard.color !== 'wild') {
        cardEl.classList.add('custom-colored');
        cardEl.style.backgroundColor = topCard.color;
      }
    }

    const sym = topCard.value;
    let displaySym = sym;
    let extraClass = '';

    if (topCard.type === 'action') {
      if (sym === 'skip') displaySym = '⊘';
      else if (sym === 'reverse') displaySym = '⇆';
      else if (sym === 'draw2') displaySym = '+2';
    } else if (topCard.type === 'wild') {
      displaySym = (sym === 'wild4') ? '+4' : ((sym === 'swap') ? '🔀' : 'W');
    }

    cardEl.innerHTML = `
      ${renderCardContent(displaySym, extraClass)}
      ${topCard.type === 'custom' ? `<div class="card-details-tooltip"><b>${topCard.name}</b><br>${topCard.description || 'Custom Card'}</div>` : ''}
    `;

    cardEl.style.setProperty('--start-x', '0px');
    cardEl.style.setProperty('--start-y', '250px');
    cardEl.style.setProperty('--start-rot', '0deg');
    cardEl.style.setProperty('--end-rot', '-4deg');
    discardStack.appendChild(cardEl);
  }

  // Radial player placement relative to current player (always at the bottom)
  function renderRadialPlayers(players, activeIndex) {
    const table = document.getElementById('unoTable');
    if (!table) return;

    // Clear old elements from the table that are players (keep table-center)
    const playersOnTable = document.querySelectorAll('.table-player');
    playersOnTable.forEach(p => p.remove());

    // Dynamically calculate radius based on actual table display size (matching CSS queries)
    const isMobile = window.innerWidth <= 768;
    const tableWidth = isMobile ? 320 : 460;
    const tableHeight = isMobile ? 250 : 320;
    const radiusX = Math.round(tableWidth / 2) - 15;
    const radiusY = Math.round(tableHeight / 2) - 15;
    const totalPlayers = players.length;

    // Find the current player's index in the list
    const myIndex = players.findIndex(p => p.name === playerName);
    if (myIndex === -1) return;

    players.forEach((p, index) => {
      // Calculate radial coordinates relative to my index so that I am always at the bottom (angle PI/2)
      const offsetIndex = (index - myIndex + totalPlayers) % totalPlayers;
      const angle = (offsetIndex * (2 * Math.PI) / totalPlayers) + (Math.PI / 2);
      
      const x = Math.round(Math.cos(angle) * radiusX);
      const y = Math.round(Math.sin(angle) * radiusY);

      const playerDiv = document.createElement('div');
      playerDiv.className = 'table-player';
      if (index === activeIndex) {
        playerDiv.classList.add('active');
      }

      // Position the element relative to table center
      playerDiv.style.left = `calc(50% + ${x}px)`;
      playerDiv.style.top = `calc(50% + ${y}px)`;

      const unoBadge = p.unoDeclared && !p.hasWon ? '<span class="uno-badge">UNO!</span>' : '';

      let cardBadgeHtml = `<div class="card-badge">${p.cardCount}</div>`;
      let wonOverlay = '';
      if (p.hasWon) {
        cardBadgeHtml = `<div class="card-badge rank-badge" style="background: var(--clr-yellow); color: #000; font-weight: 800; border: 2px solid #000;">#${p.rank}</div>`;
        wonOverlay = `<div class="won-overlay-tag" style="position: absolute; top: -14px; font-size: 0.65rem; background: var(--clr-yellow); color: #000; border-radius: 4px; padding: 2px 6px; font-weight: 700; font-family: var(--font-display); box-shadow: 0 0 10px rgba(229, 169, 0, 0.4); text-transform: uppercase; z-index: 10;">Finished</div>`;
      }

      // Inject speech bubble if active
      const activeMsg = activePlayerMessages.get(p.name);
      let bubbleHtml = '';
      if (activeMsg) {
        bubbleHtml = `<div class="speech-bubble active ${activeMsg.isEmoji ? 'is-emoji' : ''}">${activeMsg.message}</div>`;
      }

      let nameHtml = p.name;
      if (p.name.endsWith(' (Host)')) {
        const baseName = p.name.substring(0, p.name.length - 7);
        nameHtml = `${baseName} <span class="host-badge-tag" style="background: var(--clr-red); color: white; border-radius: 3px; padding: 1px 3.5px; font-size: 0.58rem; font-weight: bold; border: 1px solid rgba(255,255,255,0.15);">HOST</span>`;
      }
      const isMeSuffix = index === myIndex ? ' (You)' : '';
      const nameText = isMeSuffix ? `${nameHtml} <span style="font-size: 0.75rem; opacity: 0.7; margin-left: 2px;">(You)</span>` : nameHtml;

      playerDiv.innerHTML = `
        ${wonOverlay}
        ${bubbleHtml}
        <div class="avatar-circle" style="${p.hasWon ? 'opacity: 0.6; border-color: var(--clr-yellow) !important;' : ''}">
          <span class="avatar-emoji ${getAvatarAnimClass(p.avatar)}">${p.avatar}</span>
          ${cardBadgeHtml}
        </div>
        <div class="name" style="${p.hasWon ? 'color: var(--clr-yellow); font-weight: 700;' : ''}; display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; white-space: nowrap;">${nameText}</div>
        ${unoBadge}
      `;

      table.appendChild(playerDiv);
    });
  }

  function applyClientHandSorting() {
    if (activeSortType === 'color') {
      myHand.sort((a, b) => {
        const colorOrder = { 'red': 0, 'blue': 1, 'green': 2, 'yellow': 3, 'wild': 4 };
        const colorA = a.color || 'wild';
        const colorB = b.color || 'wild';
        if (colorOrder[colorA] !== colorOrder[colorB]) {
          return colorOrder[colorA] - colorOrder[colorB];
        }
        return String(a.value).localeCompare(String(b.value));
      });
    } else if (activeSortType === 'value') {
      myHand.sort((a, b) => {
        const valA = String(a.value);
        const valB = String(b.value);
        if (valA !== valB) {
          return valA.localeCompare(valB);
        }
        const colorOrder = { 'red': 0, 'blue': 1, 'green': 2, 'yellow': 3, 'wild': 4 };
        return colorOrder[a.color || 'wild'] - colorOrder[b.color || 'wild'];
      });
    }
  }

  // Handle dynamic screen resizing to reposition player avatars instantly
  window.addEventListener('resize', () => {
    if (currentPlayers.length > 0 && gameTableContainer.style.display === 'flex') {
      renderRadialPlayers(currentPlayers, currentActivePlayerIndex);
    }
  });

});
