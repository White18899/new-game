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
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const gameOverStandings = document.getElementById('gameOverStandings');
  const btnExitGameOver = document.getElementById('btnExitGameOver');
  const btnPlayerRematch = document.getElementById('btnPlayerRematch');
  const opponentsList = document.getElementById('opponentsList');
  const recentPlaysFeed = document.getElementById('recentPlaysFeed');

  // Populate HUD details
  hudAvatar.innerText = playerAvatar;
  hudName.innerText = playerName;
  hudRoom.innerText = roomCode;

  let myHand = [];
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
  if (btnExitRoom) {
    btnExitRoom.addEventListener('click', () => {
      if (confirm('Are you sure you want to leave the game and return to the main lobby?')) {
        sessionStorage.clear();
        window.location.href = '/index.html';
      }
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

          div.innerHTML = `
            <div class="opponent-name-wrapper">
              <span>${p.avatar}</span>
              <span style="${p.isTurn ? 'font-weight: 700; color: #fff;' : 'color: #ccc;'}">${p.name}</span>
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

  // Render player cards
  function renderHand() {
    playerHand.innerHTML = '';
    selectedCards = selectedCards.filter(id => myHand.some(c => c.id === id));
    updatePlayButtonHUD();

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
      <span class="card-corner top">${displaySym || ''}</span>
      <div class="card-center">
        <span class="card-center-val ${extraClass}">${displaySym}</span>
      </div>
      <span class="card-corner bottom">${displaySym || ''}</span>
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

      playerDiv.innerHTML = `
        ${wonOverlay}
        <div class="avatar-circle" style="${p.hasWon ? 'opacity: 0.6; border-color: var(--clr-yellow) !important;' : ''}">
          ${p.avatar}
          ${cardBadgeHtml}
        </div>
        <div class="name" style="${p.hasWon ? 'color: var(--clr-yellow); font-weight: 700;' : ''}">${p.name} ${p.name === playerName ? '(You)' : ''}</div>
        ${unoBadge}
      `;

      table.appendChild(playerDiv);
    });
  }

  // Handle dynamic screen resizing to reposition player avatars instantly
  window.addEventListener('resize', () => {
    if (currentPlayers.length > 0 && gameTableContainer.style.display === 'flex') {
      renderRadialPlayers(currentPlayers, currentActivePlayerIndex);
    }
  });

});
