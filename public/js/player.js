document.addEventListener('DOMContentLoaded', () => {
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
  const colorPickerOverlay = document.getElementById('colorPickerOverlay');

  // Populate HUD details
  hudAvatar.innerText = playerAvatar;
  hudName.innerText = playerName;
  hudRoom.innerText = roomCode;

  let myHand = [];
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
    myHand = state.hand || [];
    isMyTurn = state.isMyTurn;
    activeColor = state.currentColor;
    activeValue = state.currentValue;
    activeDrawStack = state.drawStack;
    activeHouseRules = state.houseRules || {};

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
      if (isMyTurn) {
        turnIndicator.className = 'game-status-glow your-turn';
        turnIndicator.innerText = 'YOUR TURN!';
      } else {
        const currentTurnPlayer = state.players[state.currentPlayerIndex] || { name: 'Player' };
        turnIndicator.className = 'game-status-glow waiting';
        turnIndicator.innerText = `WAITING FOR ${currentTurnPlayer.name.toUpperCase()}...`;
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

    // 6. Render Hand
    renderHand();
  });

  // Render player cards
  function renderHand() {
    playerHand.innerHTML = '';
    selectedCards = selectedCards.filter(id => myHand.some(c => c.id === id));
    updatePlayButtonHUD();

    if (myHand.length === 0) {
      playerHand.innerHTML = '<div style="color: var(--text-secondary); font-style: italic; width: 100%; text-align: center; padding: 20px;">No cards in hand.</div>';
      return;
    }

    myHand.forEach((c) => {
      const cardEl = document.createElement('div');
      cardEl.className = `uno-card ${c.color}`;
      
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
        displaySym = (sym === 'wild4') ? '+4' : 'W';
        extraClass = '';
      }

      cardEl.innerHTML = `
        <span class="card-corner top">${displaySym || ''}</span>
        <div class="card-center">
          <span class="card-center-val ${extraClass}">${displaySym}</span>
        </div>
        <span class="card-corner bottom">${displaySym || ''}</span>
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
            socket.emit('play_card', { roomCode, cardId: c.id });
          }
        }
      });

      playerHand.appendChild(cardEl);
    });
  }

  // Draw Discard Pile preview card
  function renderDiscardPreview(card, currentColor) {
    boardDiscardPreview.innerHTML = '';
    
    // Update active color hud label
    hudColorBadge.innerText = `ACTIVE COLOR: ${currentColor.toUpperCase()}`;
    hudColorBadge.className = 'color-badge ' + currentColor;

    if (!card) {
      boardDiscardPreview.innerHTML = `
        <div class="uno-card glass-panel" style="border-color: rgba(255,255,255,0.1)">
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
      displaySym = (sym === 'wild4') ? '+4' : 'W';
      extraClass = '';
    }

    cardEl.innerHTML = `
      <span class="card-corner top">${displaySym || ''}</span>
      <div class="card-center">
        <span class="card-center-val ${extraClass}">${displaySym}</span>
      </div>
      <span class="card-corner bottom">${displaySym || ''}</span>
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

  // Play Selected Cards click handler
  btnPlaySelected.addEventListener('click', () => {
    if (selectedCards.length === 0) return;

    const hasWild = selectedCards.some(id => {
      const c = myHand.find(card => card.id === id);
      if (!c) return false;
      return c.color === 'wild' || c.color === 'wild4' || (c.type === 'custom' && c.actions && c.actions.some(a => a.type === 'choose_color'));
    });

    if (hasWild) {
      pendingWildCardIds = [...selectedCards];
      pendingWildCardId = null;
      colorPickerOverlay.classList.add('active');
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
        socket.emit('play_card', {
          roomCode,
          cardId: pendingWildCardId,
          chosenColor: chosenColor
        });
        pendingWildCardId = null;
        colorPickerOverlay.classList.remove('active');
      } else if (pendingWildCardIds && pendingWildCardIds.length > 0) {
        socket.emit('play_card', {
          roomCode,
          cardIds: pendingWildCardIds,
          chosenColor: chosenColor
        });
        pendingWildCardIds = null;
        selectedCards = [];
        updatePlayButtonHUD();
        colorPickerOverlay.classList.remove('active');
      }
    });
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

});
