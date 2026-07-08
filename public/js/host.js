document.addEventListener('DOMContentLoaded', () => {
  const isHost = sessionStorage.getItem('uno_isHost') === 'true';
  let roomCode = sessionStorage.getItem('uno_roomCode');

  if (!isHost) {
    alert('Invalid host session. Returning to home lobby.');
    window.location.href = '/index.html';
    return;
  }

  // Connect socket
  const socket = io();

  // Socket connected, request room creation or reconnect
  socket.on('connect', () => {
    if (roomCode) {
      // Try to reconnect host
      socket.emit('reconnect_host', { roomCode }, (res) => {
        if (res.status === 'ok') {
          console.log(`Successfully reconnected host to room: ${roomCode}`);
          document.getElementById('roomCodeVal').innerText = roomCode;
          if (btnJoinAsPlayer) btnJoinAsPlayer.style.display = 'inline-flex';
          if (btnLobbyJoinAsPlayer) btnLobbyJoinAsPlayer.style.display = 'inline-flex';
        } else {
          console.log(`Failed to reconnect host: ${res.message}. Creating a new room.`);
          createNewRoom();
        }
      });
    } else {
      createNewRoom();
    }
  });

  function createNewRoom() {
    socket.emit('create_room', (res) => {
      if (res.status === 'ok') {
        roomCode = res.roomCode;
        sessionStorage.setItem('uno_roomCode', roomCode);
        document.getElementById('roomCodeVal').innerText = roomCode;
        console.log(`Lobby successfully created on server with room code: ${roomCode}`);
        if (btnJoinAsPlayer) btnJoinAsPlayer.style.display = 'inline-flex';
        if (btnLobbyJoinAsPlayer) btnLobbyJoinAsPlayer.style.display = 'inline-flex';
      } else {
        alert('Failed to create room. Returning to lobby.');
        window.location.href = '/index.html';
      }
    });
  }

  // UI Targets
  const lobbyPanel = document.getElementById('lobbyPanel');
  const gamePanel = document.getElementById('gamePanel');
  const lobbyPlayersGrid = document.getElementById('lobbyPlayersGrid');
  const playerCountSpan = document.getElementById('playerCount');
  const btnStartGame = document.getElementById('btnStartGame');
  const btnJoinAsPlayer = document.getElementById('btnJoinAsPlayer');
  const btnLobbyJoinAsPlayer = document.getElementById('btnLobbyJoinAsPlayer');
  const connectUrlSpan = document.getElementById('connectUrl');
  const discardStack = document.getElementById('discardStack');
  const gameLogs = document.getElementById('gameLogs');
  const activeColorIndicator = document.getElementById('activeColorIndicator');
  const activeColorText = document.getElementById('activeColorText');
  const directionIndicator = document.getElementById('directionIndicator');
  const penaltyStackIndicator = document.getElementById('penaltyStackIndicator');
  const penaltyStackCount = document.getElementById('penaltyStackCount');
  const unoAlertOverlay = document.getElementById('unoAlertOverlay');
  const unoShoutTitle = document.getElementById('unoShoutTitle');
  const unoShoutMsg = document.getElementById('unoShoutMsg');
  const btnHostRematch = document.getElementById('btnHostRematch');

  // Rule switches
  const ruleStacking = document.getElementById('ruleStacking');
  const ruleDrawMatch = document.getElementById('ruleDrawMatch');
  const ruleJumpIn = document.getElementById('ruleJumpIn');
  const ruleNo2on4 = document.getElementById('ruleNo2on4');

  // Custom Card Creator UI Targets
  const custName = document.getElementById('custName');
  const custSymbol = document.getElementById('custSymbol');
  const custColor = document.getElementById('custColor');
  const effectDraw = document.getElementById('effectDraw');
  const effectDrawQty = document.getElementById('effectDrawQty');
  const effectSkip = document.getElementById('effectSkip');
  const effectReverse = document.getElementById('effectReverse');
  const effectSwap = document.getElementById('effectSwap');
  const effectSwapAny = document.getElementById('effectSwapAny');
  const effectDrawMatch = document.getElementById('effectDrawMatch');
  const btnAddCustomCard = document.getElementById('btnAddCustomCard');
  const cardPreview = document.getElementById('cardPreview');
  const previewCornerVal = document.getElementById('previewCornerVal');
  const previewCornerVal2 = document.getElementById('previewCornerVal2');
  const previewCenterVal = document.getElementById('previewCenterVal');
  const customCardCountVal = document.getElementById('customCardCountVal');

  // Custom Card Creator Image Symbol Targets
  const symbolTypeRadios = document.getElementsByName('symbolType');
  const symbolTextInputGroup = document.getElementById('symbolTextInputGroup');
  const symbolImageInputGroup = document.getElementById('symbolImageInputGroup');
  const custSymbolFile = document.getElementById('custSymbolFile');
  let uploadedSymbolImgData = '';

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

  let localCustomCardsCount = 0;
  let currentTopCard = null;
  let lastTopCardId = null;
  let lastTotalCards = 0;
  let lastLogLength = 0;
  let lastReceivedState = null;
  let activePlayerMessages = new Map();

  // Exit Room Controller
  const btnExitRoom = document.getElementById('btnExitRoom');
  if (btnExitRoom) {
    btnExitRoom.addEventListener('click', () => {
      if (confirm('Are you sure you want to close this room and return to the main lobby?')) {
        sessionStorage.clear();
        window.location.href = '/index.html';
      }
    });
  }

  // Join as Player Controller
  const handleJoinAsPlayer = () => {
    if (!roomCode) return;
    const inputEl = document.getElementById('hostPlayerName');
    let name = inputEl ? inputEl.value.trim() : 'Host';
    if (!name) name = 'Host';

    // Append host tag if not already present
    let displayName = name;
    if (!displayName.toLowerCase().includes('(host)')) {
      displayName = `${name} (Host)`;
    }

    const avatarEl = document.getElementById('hostPlayerAvatar');
    const avatar = avatarEl ? avatarEl.value : '👑';

    const url = `/player.html?roomCode=${roomCode}&playerName=${encodeURIComponent(displayName)}&avatar=${encodeURIComponent(avatar)}`;
    window.open(url, '_blank');
  };

  if (btnJoinAsPlayer) {
    btnJoinAsPlayer.addEventListener('click', handleJoinAsPlayer);
  }
  if (btnLobbyJoinAsPlayer) {
    btnLobbyJoinAsPlayer.addEventListener('click', handleJoinAsPlayer);
  }

  // Copy Room Code Controller
  const btnCopyCode = document.getElementById('btnCopyCode');
  if (btnCopyCode) {
    btnCopyCode.addEventListener('click', () => {
      const roomCodeText = document.getElementById('roomCodeVal').innerText;
      if (roomCodeText && roomCodeText !== '----') {
        navigator.clipboard.writeText(roomCodeText).then(() => {
          // Success feedback (checkmark SVG)
          btnCopyCode.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" style="width: 14px; height: 14px;">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
          setTimeout(() => {
            btnCopyCode.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            `;
          }, 1500);
        }).catch(err => {
          console.error('Failed to copy text: ', err);
        });
      }
    });
  }

  // Sound Controller
  const btnMuteSound = document.getElementById('btnMuteSound');
  if (btnMuteSound) {
    btnMuteSound.addEventListener('click', () => {
      const isMuted = window.gameSound.toggleMute();
      btnMuteSound.innerHTML = isMuted ? `
        <svg class="audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
          <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
          <line x1="23" y1="9" x2="17" y2="15"></line>
          <line x1="17" y1="9" x2="23" y2="15"></line>
        </svg>
        Audio: Off
      ` : `
        <svg class="audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
          <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
        Audio: On
      `;
      btnMuteSound.classList.toggle('active', !isMuted);
    });
  }

  // Real-time Preview updates
  function updatePreview() {
    const activeRadio = Array.from(symbolTypeRadios).find(r => r.checked);
    const useImage = activeRadio && activeRadio.value === 'image';
    
    let symbol = '?';
    if (useImage) {
      symbol = uploadedSymbolImgData || 'data:image/svg+xml;utf8,<svg fill=\'none\' stroke=\'white\' stroke-opacity=\'0.2\' stroke-width=\'2\' viewBox=\'0 0 24 24\' xmlns=\'http://www.w3.org/2000/svg\'><rect x=\'3\' y=\'3\' width=\'18\' height=\'18\' rx=\'2\'/><circle cx=\'8.5\' cy=\'8.5\' r=\'1.5\'/><path d=\'M21 15l-5-5L5 21\'/></svg>';
    } else {
      symbol = custSymbol.value.trim() || '?';
    }

    // Render inner content dynamically based on whether it is an image
    cardPreview.innerHTML = renderCardContent(symbol, '');

    // Remove old colors
    cardPreview.className = 'uno-card custom-card';
    const color = custColor.value;
    if (color === 'wild') {
      cardPreview.classList.add('wild');
    } else {
      cardPreview.classList.add(color);
    }
  }

  // Radio toggles change
  symbolTypeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'image') {
        symbolTextInputGroup.classList.add('none');
        symbolImageInputGroup.classList.remove('none');
      } else {
        symbolImageInputGroup.classList.add('none');
        symbolTextInputGroup.classList.remove('none');
      }
      updatePreview();
    });
  });

  // Image reader
  custSymbolFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        uploadedSymbolImgData = event.target.result;
        updatePreview();
      };
      reader.readAsDataURL(file);
    }
  });

  [custName, custSymbol, custColor].forEach(el => {
    el.addEventListener('input', updatePreview);
  });
  custColor.addEventListener('change', updatePreview);
  updatePreview(); // Initial setup

  // Emit Custom Card
  btnAddCustomCard.addEventListener('click', () => {
    const name = custName.value.trim() || 'Custom Action';
    const activeRadio = Array.from(symbolTypeRadios).find(r => r.checked);
    const useImage = activeRadio && activeRadio.value === 'image';
    
    let symbol = '*';
    if (useImage) {
      if (!uploadedSymbolImgData) {
        alert('Please upload a symbol image first.');
        return;
      }
      symbol = uploadedSymbolImgData;
    } else {
      symbol = custSymbol.value.trim() || '*';
    }
    const color = custColor.value;

    const actions = [];
    if (effectDraw.checked) {
      actions.push({ type: 'draw', count: parseInt(effectDrawQty.value) || 1 });
    }
    if (effectSkip.checked) {
      actions.push({ type: 'skip' });
    }
    if (effectReverse.checked) {
      actions.push({ type: 'reverse' });
    }
    if (effectSwap.checked) {
      actions.push({ type: 'swap', target: 'next' });
    }
    if (effectSwapAny.checked) {
      actions.push({ type: 'swap', target: 'chosen' });
    }
    if (effectDrawMatch.checked) {
      actions.push({ type: 'draw_till_color' });
    }

    if (actions.length === 0) {
      alert('Please check at least one effect for your custom card.');
      return;
    }

    const newCard = {
      name,
      symbol,
      color,
      actions,
      qty: 4 // Add 4 copies of custom cards by default to ensure they show up in deck
    };

    socket.emit('add_custom_card', { roomCode, card: newCard });
    localCustomCardsCount++;
    customCardCountVal.innerText = localCustomCardsCount;

    // Reset fields partly
    custName.value = 'Draw 5 Skip';
    custSymbol.value = '+5';
    custSymbolFile.value = '';
    uploadedSymbolImgData = '';
    symbolTypeRadios[0].checked = true;
    symbolImageInputGroup.classList.add('none');
    symbolTextInputGroup.classList.remove('none');
    effectDraw.checked = true;
    effectDrawQty.value = 5;
    effectSkip.checked = true;
    effectReverse.checked = false;
    effectSwap.checked = false;
    effectSwapAny.checked = false;
    effectDrawMatch.checked = false;
    updatePreview();
  });

  // Bind Rule Toggles
  [ruleStacking, ruleDrawMatch, ruleJumpIn, ruleNo2on4].forEach(switchEl => {
    switchEl.addEventListener('change', (e) => {
      let ruleKey = '';
      if (switchEl === ruleStacking) ruleKey = 'stacking';
      if (switchEl === ruleDrawMatch) ruleKey = 'drawToMatch';
      if (switchEl === ruleJumpIn) ruleKey = 'jumpIn';
      if (switchEl === ruleNo2on4) ruleKey = 'no2on4';

      socket.emit('toggle_house_rule', {
        roomCode,
        rule: ruleKey,
        value: switchEl.checked
      });
    });
  });

  // Start Game Button
  btnStartGame.addEventListener('click', () => {
    const startCardsInput = document.getElementById('startingCardCount');
    const startingCardCount = startCardsInput ? parseInt(startCardsInput.value) || 7 : 7;
    socket.emit('start_game', { roomCode, startingCardCount });
  });

  // Receive Game State updates
  socket.on('host_state', (state) => {
    lastReceivedState = state;
    // Show connection URL
    connectUrlSpan.innerText = `http://${state.roomCode ? window.location.host : '...'}/`;

    // Manage Panel Displays
    if (state.status === 'lobby') {
      lobbyPanel.style.display = 'flex';
      gamePanel.style.display = 'none';
      renderLobbyPlayers(state.players);
      lastTopCardId = null;
      lastTotalCards = 0;
      lastLogLength = 0;
      if (btnLobbyJoinAsPlayer) btnLobbyJoinAsPlayer.style.display = 'inline-flex';
    } else {
      lobbyPanel.style.display = 'none';
      gamePanel.style.display = 'flex';
      renderGameTable(state);
      if (btnLobbyJoinAsPlayer) btnLobbyJoinAsPlayer.style.display = 'none';
    }
  });

  // Render player grid in lobby
  function renderLobbyPlayers(players) {
    playerCountSpan.innerText = players.length;
    lobbyPlayersGrid.innerHTML = '';

    if (players.length === 0) {
      lobbyPlayersGrid.innerHTML = '<div class="waiting-prompt">No players connected yet. Scan QR code or enter code on your device.</div>';
      btnStartGame.disabled = true;
      return;
    }

    players.forEach(p => {
      const card = document.createElement('div');
      card.className = 'lobby-player-card';
      
      let nameHtml = p.name;
      if (p.name.endsWith(' (Host)')) {
        const baseName = p.name.substring(0, p.name.length - 7);
        nameHtml = `${baseName} <span class="host-badge-tag" style="background: var(--clr-red); color: white; border-radius: 4px; padding: 1px 4px; font-size: 0.65rem; font-weight: bold; margin-left: 4px; border: 1px solid rgba(255,255,255,0.2); display: inline-block;">HOST</span>`;
      }

      card.innerHTML = `
        <div class="avatar">${p.avatar}</div>
        <div class="name" style="display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%;">${nameHtml}</div>
      `;
      lobbyPlayersGrid.appendChild(card);
    });

    btnStartGame.disabled = players.length < 2;
  }



  // Render playing game board
  function renderGameTable(state) {
    // 1. Logs
    renderLogs(state.logs);

    // Check logs for Uno calls
    if (state.logs && state.logs.length > lastLogLength) {
      const newLogs = state.logs.slice(lastLogLength);
      newLogs.forEach(log => {
        const lower = log.toLowerCase();
        if (lower.includes('shouted uno') || lower.includes('uno!')) {
          window.gameSound.playUnoFanfare();
        }
      });
      lastLogLength = state.logs.length;
    } else if (!state.logs) {
      lastLogLength = 0;
    }

    // 2. Active Color indicators
    activeColorIndicator.className = 'active-rule-glow ' + state.currentColor;
    activeColorText.innerText = state.currentColor.toUpperCase();

    // 3. Stacking counts
    if (state.drawStack > 0) {
      penaltyStackIndicator.style.display = 'block';
      penaltyStackCount.innerText = `+${state.drawStack}`;
    } else {
      penaltyStackIndicator.style.display = 'none';
    }

    // 4. Play and Draw Sound triggers
    const totalCards = state.players.reduce((sum, p) => sum + p.cardCount, 0);
    if (totalCards > lastTotalCards) {
      if (lastTotalCards > 0) {
        window.gameSound.playDraw();
      }
    }
    lastTotalCards = totalCards;

    const pile = state.discardPile || [];
    const topCard = pile[0];
    if (topCard && topCard.id !== lastTopCardId) {
      if (lastTopCardId !== null) {
        window.gameSound.playThrow();
      }
      lastTopCardId = topCard.id;
    }

    // 4. Direction
    directionIndicator.className = 'direction-indicator ' + (state.direction === 1 ? 'clockwise' : 'counter-clockwise');

    // 5. Discard Pile rendering (with throw animations)
    renderDiscardPile(state.discardPile);

    // 6. Radial Players
    renderRadialPlayers(state.players, state.currentPlayerIndex, state.direction);
  }

  // Draw logs
  function renderLogs(logs) {
    gameLogs.innerHTML = '';
    logs.forEach(log => {
      const div = document.createElement('div');
      div.innerText = log;
      // Highlight special terms
      if (log.includes('won')) div.style.color = 'var(--clr-yellow)';
      else if (log.includes('shouted UNO')) div.style.color = 'var(--clr-green)';
      else if (log.includes('called out')) div.style.color = 'var(--clr-red)';
      else if (log.includes('Jump-In')) div.style.color = 'cyan';
      gameLogs.appendChild(div);
    });
    // Auto-scroll
    gameLogs.scrollTop = gameLogs.scrollHeight;
  }

  // Radial player placement
  function renderRadialPlayers(players, activeIndex, direction) {
    // Clear old elements from the table that are players (keep table-center)
    const playersOnTable = document.querySelectorAll('.table-player');
    playersOnTable.forEach(p => p.remove());

    const table = document.getElementById('unoTable');
    const radius = 210; // Pixels from center
    const totalPlayers = players.length;

    players.forEach((p, index) => {
      // Calculate radial coordinates
      // Place first player at the bottom (angle PI/2) and spread out evenly
      const angle = (index * (2 * Math.PI) / totalPlayers) + (Math.PI / 2);
      
      const x = Math.round(Math.cos(angle) * radius);
      const y = Math.round(Math.sin(angle) * radius);

      const playerDiv = document.createElement('div');
      playerDiv.className = 'table-player';
      if (index === activeIndex) {
        playerDiv.classList.add('active');
      }

      // Position the element relative to table center
      playerDiv.style.left = `calc(50% + ${x}px - 45px)`;
      playerDiv.style.top = `calc(50% + ${y}px - 50px)`;

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
        nameHtml = `${baseName} <span class="host-badge-tag" style="background: var(--clr-red); color: white; border-radius: 3px; padding: 1px 3px; font-size: 0.6rem; font-weight: bold; vertical-align: middle; border: 1px solid rgba(255,255,255,0.15);">HOST</span>`;
      }

      playerDiv.innerHTML = `
        ${wonOverlay}
        ${bubbleHtml}
        <div class="avatar-circle" style="${p.hasWon ? 'opacity: 0.6; border-color: var(--clr-yellow) !important;' : ''}">
          ${p.avatar}
          ${cardBadgeHtml}
        </div>
        <div class="name" style="${p.hasWon ? 'color: var(--clr-yellow); font-weight: 700;' : ''}; display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; white-space: nowrap;">${nameHtml}</div>
        ${unoBadge}
      `;

      table.appendChild(playerDiv);
    });
  }

  // Discard pile with smooth overlay offsets
  function renderDiscardPile(pile) {
    if (!pile || pile.length === 0) {
      discardStack.innerHTML = '';
      currentTopCard = null;
      return;
    }

    const newTopCard = pile[0];

    // If top card hasn't changed, we don't redraw the pile to avoid losing physical positions
    if (currentTopCard && currentTopCard.id === newTopCard.id) {
      return;
    }

    currentTopCard = newTopCard;
    discardStack.innerHTML = '';

    // Render up to 4 historical cards under the top one with random rotations
    const historyCards = pile.slice(0, 5).reverse();
    
    historyCards.forEach((c, idx) => {
      const cardEl = document.createElement('div');
      cardEl.className = `uno-card ${c.color}`;
      if (c.type === 'custom') {
        cardEl.classList.add('custom-card');
        if (c.color !== 'red' && c.color !== 'blue' && c.color !== 'green' && c.color !== 'yellow' && c.color !== 'wild') {
          cardEl.classList.add('custom-colored');
          cardEl.style.backgroundColor = c.color;
        }
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

      // Set slight random offsets/rotations for historical stack effect
      let rot = 0;
      let offX = 0;
      let offY = 0;

      if (idx < historyCards.length - 1) {
        // Pseudo-random seed based on card ID to keep coordinates consistent
        const seed = c.id.charCodeAt(c.id.length - 1) || 5;
        rot = (seed % 20) - 10;
        offX = (seed % 10) - 5;
        offY = (seed % 8) - 4;
        cardEl.style.transform = `translate(${offX}px, ${offY}px) rotate(${rot}deg)`;
      } else {
        // Animation variables for the newly thrown top card
        cardEl.style.setProperty('--start-x', '0px');
        cardEl.style.setProperty('--start-y', '300px');
        cardEl.style.setProperty('--start-rot', '90deg');
        
        const endRot = ((c.id.charCodeAt(c.id.length - 1) || 5) % 12) - 6;
        cardEl.style.setProperty('--end-x', '0px');
        cardEl.style.setProperty('--end-y', '0px');
        cardEl.style.setProperty('--end-rot', `${endRot}deg`);
        cardEl.classList.add('thrown-card');
      }

      discardStack.appendChild(cardEl);
    });
  }

  // UNO Notification Handler
  socket.on('uno_notification', (data) => {
    unoShoutTitle.innerText = 'UNO!';
    unoShoutMsg.innerText = data.message;
    if (btnHostRematch) btnHostRematch.style.display = 'none';
    unoAlertOverlay.classList.add('active');
    setTimeout(() => {
      if (unoShoutTitle.innerText === 'UNO!') {
        unoAlertOverlay.classList.remove('active');
      }
    }, 3000);
  });

  // Dismiss overlay when clicked
  if (unoAlertOverlay) {
    unoAlertOverlay.addEventListener('click', () => {
      if (unoShoutTitle.innerText !== 'MATCH OVER!') {
        unoAlertOverlay.classList.remove('active');
      }
    });
  }

  // Game Over Alert
  socket.on('game_over_announcement', (data) => {
    unoShoutTitle.innerText = 'MATCH OVER!';
    let msg = `<div style="display: flex; flex-direction: column; gap: 8px; font-size: 1rem; margin-top: 10px; width: 240px; margin-left: auto; margin-right: auto; text-align: left;">`;
    if (data.standings) {
      data.standings.forEach(s => {
        msg += `<div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #222; padding-bottom: 4px; ${s.rank === 1 ? 'color: var(--clr-yellow); font-weight: 700;' : ''}">
          <span>Rank #${s.rank}</span>
          <span>${s.name}</span>
        </div>`;
      });
    } else {
      msg += `<div style="text-align: center;">Winner: ${data.winner}</div>`;
    }
    msg += `</div>`;
    
    unoShoutMsg.innerHTML = msg;
    if (btnHostRematch) btnHostRematch.style.display = 'block';
    unoAlertOverlay.classList.add('active');
  });

  // Rematch Button event binding
  if (btnHostRematch) {
    btnHostRematch.addEventListener('click', (e) => {
      e.stopPropagation();
      socket.emit('rematch', { roomCode });
    });
  }

  // Listen for rematch start
  socket.on('rematch_started', () => {
    unoAlertOverlay.classList.remove('active');
  });

  function refreshPlayers() {
    if (lastReceivedState) {
      renderRadialPlayers(lastReceivedState.players, lastReceivedState.currentPlayerIndex, lastReceivedState.direction);
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

  // Standard Alerts
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


});
