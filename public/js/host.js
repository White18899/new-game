document.addEventListener('DOMContentLoaded', () => {
  const roomCode = sessionStorage.getItem('uno_roomCode');
  const isHost = sessionStorage.getItem('uno_isHost') === 'true';

  if (!roomCode || !isHost) {
    alert('Invalid room session. Returning to home lobby.');
    window.location.href = '/index.html';
    return;
  }

  // Connect socket
  const socket = io();

  // Socket connected, join room as host
  socket.on('connect', () => {
    console.log(`Connected to server as Host for room ${roomCode}`);
    // Register this socket as host (by re-confirming room code in lobby state or checking if room exists)
    // Actually the server already knows this is the host socket because we created the room, 
    // but just to be sure we let the server know we're linking the host socket:
    document.getElementById('roomCodeVal').innerText = roomCode;
  });

  // UI Targets
  const lobbyPanel = document.getElementById('lobbyPanel');
  const gamePanel = document.getElementById('gamePanel');
  const lobbyPlayersGrid = document.getElementById('lobbyPlayersGrid');
  const playerCountSpan = document.getElementById('playerCount');
  const btnStartGame = document.getElementById('btnStartGame');
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

  // Rule switches
  const ruleStacking = document.getElementById('ruleStacking');
  const ruleDrawMatch = document.getElementById('ruleDrawMatch');
  const ruleJumpIn = document.getElementById('ruleJumpIn');

  // Custom Card Creator UI Targets
  const custName = document.getElementById('custName');
  const custSymbol = document.getElementById('custSymbol');
  const custColor = document.getElementById('custColor');
  const effectDraw = document.getElementById('effectDraw');
  const effectDrawQty = document.getElementById('effectDrawQty');
  const effectSkip = document.getElementById('effectSkip');
  const effectReverse = document.getElementById('effectReverse');
  const effectSwap = document.getElementById('effectSwap');
  const effectDrawMatch = document.getElementById('effectDrawMatch');
  const btnAddCustomCard = document.getElementById('btnAddCustomCard');
  const cardPreview = document.getElementById('cardPreview');
  const previewCornerVal = document.getElementById('previewCornerVal');
  const previewCornerVal2 = document.getElementById('previewCornerVal2');
  const previewCenterVal = document.getElementById('previewCenterVal');
  const customCardCountVal = document.getElementById('customCardCountVal');

  let localCustomCardsCount = 0;
  let currentTopCard = null;

  // Real-time Preview updates
  function updatePreview() {
    const symbol = custSymbol.value.trim() || '?';
    previewCornerVal.innerText = symbol;
    previewCornerVal2.innerText = symbol;
    previewCenterVal.innerText = symbol;

    // Remove old colors
    cardPreview.className = 'uno-card custom-card';
    const color = custColor.value;
    if (color === 'wild') {
      cardPreview.classList.add('wild');
    } else {
      cardPreview.classList.add(color);
    }
  }

  [custName, custSymbol, custColor].forEach(el => {
    el.addEventListener('input', updatePreview);
  });
  custColor.addEventListener('change', updatePreview);
  updatePreview(); // Initial setup

  // Emit Custom Card
  btnAddCustomCard.addEventListener('click', () => {
    const name = custName.value.trim() || 'Custom Action';
    const symbol = custSymbol.value.trim() || '*';
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
    effectDraw.checked = true;
    effectDrawQty.value = 5;
    effectSkip.checked = true;
    effectReverse.checked = false;
    effectSwap.checked = false;
    effectDrawMatch.checked = false;
    updatePreview();
  });

  // Bind Rule Toggles
  [ruleStacking, ruleDrawMatch, ruleJumpIn].forEach(switchEl => {
    switchEl.addEventListener('change', (e) => {
      let ruleKey = '';
      if (switchEl === ruleStacking) ruleKey = 'stacking';
      if (switchEl === ruleDrawMatch) ruleKey = 'drawToMatch';
      if (switchEl === ruleJumpIn) ruleKey = 'jumpIn';

      socket.emit('toggle_house_rule', {
        roomCode,
        rule: ruleKey,
        value: switchEl.checked
      });
    });
  });

  // Start Game Button
  btnStartGame.addEventListener('click', () => {
    socket.emit('start_game', { roomCode });
  });

  // Receive Game State updates
  socket.on('host_state', (state) => {
    // Show connection URL
    connectUrlSpan.innerText = `http://${state.roomCode ? window.location.host : '...'}/`;

    // Manage Panel Displays
    if (state.status === 'lobby') {
      lobbyPanel.style.display = 'flex';
      gamePanel.style.display = 'none';
      renderLobbyPlayers(state.players);
    } else {
      lobbyPanel.style.display = 'none';
      gamePanel.style.display = 'flex';
      renderGameTable(state);
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
      card.innerHTML = `
        <div class="avatar">${p.avatar}</div>
        <div class="name">${p.name}</div>
      `;
      lobbyPlayersGrid.appendChild(card);
    });

    btnStartGame.disabled = players.length < 2;
  }

  // Render playing game board
  function renderGameTable(state) {
    // 1. Logs
    renderLogs(state.logs);

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

      const unoBadge = p.unoDeclared ? '<span class="uno-badge">UNO!</span>' : '';

      playerDiv.innerHTML = `
        <div class="avatar-circle">
          ${p.avatar}
          <div class="card-badge">${p.cardCount}</div>
        </div>
        <div class="name">${p.name}</div>
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
        displaySym = '';
        extraClass = `icon-${sym}`;
      } else if (c.type === 'wild') {
        displaySym = '';
        extraClass = `icon-${sym}`;
      }

      cardEl.innerHTML = `
        <span class="card-corner top">${displaySym || ''}</span>
        <div class="card-center">
          <span class="card-center-val ${extraClass}">${displaySym}</span>
        </div>
        <span class="card-corner bottom">${displaySym || ''}</span>
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
    unoAlertOverlay.classList.add('active');
    setTimeout(() => {
      unoAlertOverlay.classList.remove('active');
    }, 3000);
  });

  // Game Over Alert
  socket.on('game_over_announcement', (data) => {
    unoShoutTitle.innerText = 'VICTORY!';
    unoShoutMsg.innerText = `${data.winner} won the game!`;
    unoAlertOverlay.classList.add('active');
    // Keep it up or let them dismiss it
    setTimeout(() => {
      unoAlertOverlay.classList.remove('active');
    }, 6000);
  });

  // Standard Alerts
  socket.on('error_message', (msg) => {
    alert(msg);
  });

  socket.on('room_closed', (msg) => {
    alert(msg);
    window.location.href = '/index.html';
  });
});
