const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Host static files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Get local network IP for player connections
let localIP = 'localhost';
const networkInterfaces = os.networkInterfaces();
for (const interfaceName in networkInterfaces) {
  for (const iface of networkInterfaces[interfaceName]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      localIP = iface.address;
      break;
    }
  }
}

// In-memory game state
// Room structure:
// {
//   roomCode: string,
//   hostSocketId: string,
//   players: [{ socketId, name, avatar, cards: [], unoDeclared: boolean }],
//   status: 'lobby' | 'playing' | 'gameover',
//   deck: [],
//   discardPile: [],
//   currentPlayerIndex: number,
//   direction: 1 | -1,
//   currentColor: string,
//   currentValue: string,
//   drawStack: number,          // Cumulative cards to draw (for +2 / +4 stacking)
//   calledOutPending: boolean,  // True if a player has 1 card but hasn't declared UNO
//   houseRules: {
//     stacking: boolean,        // Can stack +2 on +2, +4 on +2/4
//     drawToMatch: boolean,     // Keep drawing until a playable card is found
//     jumpIn: boolean,          // Play out of turn if card is exact match
//   },
//   customCards: [],            // List of custom rules/cards designed for this room
//   logs: []                    // Game action logs
const rooms = new Map();
const hostDisconnectTimeouts = new Map();

// Helper: generate 4-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate the standard Uno deck + custom cards
function generateDeck(customCards = []) {
  const deck = [];
  const colors = ['red', 'blue', 'yellow', 'green'];
  let cardId = 1;

  // Standard Uno distribution
  colors.forEach(color => {
    // Number 0 (1 card per color)
    deck.push({ id: `std_${cardId++}`, type: 'number', color, value: '0' });
    
    // Numbers 1-9 (2 cards per color)
    for (let num = 1; num <= 9; num++) {
      deck.push({ id: `std_${cardId++}`, type: 'number', color, value: String(num) });
      deck.push({ id: `std_${cardId++}`, type: 'number', color, value: String(num) });
    }

    // Action cards (2 per color)
    const actions = ['skip', 'reverse', 'draw2'];
    actions.forEach(action => {
      deck.push({ id: `std_${cardId++}`, type: 'action', color, value: action });
      deck.push({ id: `std_${cardId++}`, type: 'action', color, value: action });
    });
  });

  // Wild cards (4 of each)
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `std_${cardId++}`, type: 'wild', color: 'wild', value: 'wild' });
    deck.push({ id: `std_${cardId++}`, type: 'wild', color: 'wild', value: 'wild4' });
  }

  // Inject custom cards
  customCards.forEach(cust => {
    // Add multiple copies based on quantity requested (default 2 or 4)
    const qty = cust.qty || 2;
    for (let i = 0; i < qty; i++) {
      deck.push({
        id: `cust_${cust.name.replace(/\s+/g, '')}_${cardId++}`,
        type: 'custom',
        color: cust.color, // 'red' | 'blue' | 'yellow' | 'green' | 'wild' | custom hex
        value: cust.symbol || '?',
        name: cust.name,
        description: cust.description,
        actions: cust.actions // Array of custom sub-actions: [{type: 'draw', count: 5}, {type: 'skip'}]
      });
    }
  });

  return deck;
}

// Fisher-Yates shuffle
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Log message helper
function addLog(room, message) {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const logEntry = `[${timestamp}] ${message}`;
  room.logs.push(logEntry);
  if (room.logs.length > 50) {
    room.logs.shift();
  }
}

// Sync room state to all clients
function broadcastState(room) {
  // Broadcast public state to host
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('host_state', {
      players: room.players.map(p => ({
        name: p.name,
        avatar: p.avatar,
        cardCount: p.cards.length,
        socketId: p.socketId,
        unoDeclared: p.unoDeclared,
        online: p.online !== false,
        hasWon: p.hasWon || false,
        rank: p.rank || 0
      })),
      status: room.status,
      discardPile: room.discardPile,
      topCard: room.discardPile[0] || null,
      currentPlayerIndex: room.currentPlayerIndex,
      direction: room.direction,
      currentColor: room.currentColor,
      currentValue: room.currentValue,
      drawStack: room.drawStack,
      logs: room.logs,
      roomCode: room.roomCode,
      houseRules: room.houseRules
    });
  }

  // Broadcast individualized state to each player
  room.players.forEach((player, index) => {
    io.to(player.socketId).emit('player_state', {
      hand: player.cards,
      name: player.name,
      avatar: player.avatar,
      isMyTurn: room.status === 'playing' && room.currentPlayerIndex === index,
      currentPlayerIndex: room.currentPlayerIndex,
      players: room.players.map((p, idx) => ({
        name: p.name,
        avatar: p.avatar,
        cardCount: p.cards.length,
        isTurn: room.status === 'playing' && room.currentPlayerIndex === idx,
        unoDeclared: p.unoDeclared,
        online: p.online !== false,
        hasWon: p.hasWon || false,
        rank: p.rank || 0
      })),
      topCard: room.discardPile[0] || null,
      currentColor: room.currentColor,
      currentValue: room.currentValue,
      drawStack: room.drawStack,
      direction: room.direction,
      status: room.status,
      roomCode: room.roomCode,
      houseRules: room.houseRules,
      logs: room.logs
    });
  });
}

// Move to the next active player (skipping players who have already won/finished)
function advanceTurn(room) {
  const numPlayers = room.players.length;
  if (numPlayers === 0) return;
  
  let nextIndex = room.currentPlayerIndex;
  let count = 0;
  
  do {
    nextIndex = (nextIndex + room.direction + numPlayers) % numPlayers;
    count++;
  } while (room.players[nextIndex].hasWon && count < numPlayers);
  
  room.currentPlayerIndex = nextIndex;
}

// Play card logic / validation
function isValidPlay(card, room, playerIndex) {
  // If stacking is active and drawStack > 0, player can only play draw cards (stackable)
  if (room.houseRules.stacking && room.drawStack > 0) {
    // If no2on4 is active and top card is wild4 (+4), block +2 (draw2)
    if (room.houseRules.no2on4 && room.currentValue === 'wild4' && card.value === 'draw2') {
      return false;
    }
    if (card.value === 'draw2' || card.value === 'wild4') {
      return true;
    }
    // Custom cards with draw actions are also stackable
    if (card.type === 'custom' && card.actions.some(a => a.type === 'draw')) {
      return true;
    }
    return false;
  }

  const topCard = room.discardPile[0];
  if (!topCard) return true; // Empty pile allows anything

  // Wild cards can be played on anything
  if (card.color === 'wild' || card.color === 'wild4') return true;

  // Matching color
  if (card.color === room.currentColor) return true;

  // Matching value/number/symbol
  if (card.value === room.currentValue) return true;

  // Custom card with specific colored background matches if color matches
  if (card.type === 'custom' && card.color === room.currentColor) return true;

  return false;
}

// Check card details and process effects
function processCardEffects(card, room, chosenColor) {
  let skipNext = false;
  let drawCount = 0;
  let reverseDirection = false;
  let forceColor = false;
  let customActionList = [];

  if (card.type === 'action') {
    if (card.value === 'skip') {
      skipNext = true;
    } else if (card.value === 'reverse') {
      reverseDirection = true;
    } else if (card.value === 'draw2') {
      drawCount = 2;
    }
  } else if (card.type === 'wild') {
    forceColor = true;
    if (card.value === 'wild4') {
      drawCount = 4;
    }
  } else if (card.type === 'custom') {
    // Process list of actions defined in the custom card metadata
    customActionList = card.actions || [];
  }

  // 1. Color resolution
  if (forceColor || card.color === 'wild') {
    room.currentColor = chosenColor || 'red';
  } else {
    room.currentColor = card.color;
  }
  room.currentValue = card.value;

  // 2. Reverse resolution
  if (reverseDirection) {
    if (room.players.length === 2) {
      // In 2 player Uno, Reverse acts like a Skip
      skipNext = true;
    } else {
      room.direction *= -1;
      addLog(room, `Play direction reversed! Now flowing ${room.direction === 1 ? 'clockwise' : 'counter-clockwise'}.`);
    }
  }

  // 3. Stacking vs Immediate Draw resolution
  if (drawCount > 0) {
    if (room.houseRules.stacking) {
      room.drawStack += drawCount;
      addLog(room, `Stack increased! Cumulative draw penalty is now +${room.drawStack}.`);
    } else {
      // Immediate draw for next player without stacking
      const nextIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
      const targetPlayer = room.players[nextIndex];
      drawCardsForPlayer(room, targetPlayer, drawCount);
      addLog(room, `${targetPlayer.name} draws ${drawCount} cards.`);
      skipNext = true; // Traditional draw 2/4 skips their turn
    }
  }

  // 4. Custom action processing
  customActionList.forEach(act => {
    if (act.type === 'draw') {
      const count = parseInt(act.count) || 1;
      if (room.houseRules.stacking) {
        room.drawStack += count;
        addLog(room, `Custom Stack! Play +${count} cards. Cumulative stack: +${room.drawStack}.`);
      } else {
        const nextIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
        const targetPlayer = room.players[nextIndex];
        drawCardsForPlayer(room, targetPlayer, count);
        addLog(room, `${targetPlayer.name} draws ${count} cards from custom card.`);
        skipNext = true;
      }
    } else if (act.type === 'skip') {
      skipNext = true;
    } else if (act.type === 'reverse') {
      if (room.players.length === 2) {
        skipNext = true;
      } else {
        room.direction *= -1;
        addLog(room, `Play direction reversed by custom rule!`);
      }
    } else if (act.type === 'choose_color') {
      room.currentColor = chosenColor || 'red';
    } else if (act.type === 'swap') {
      // Executed immediately: swap hands with next or previous player
      const activePlayer = room.players[room.currentPlayerIndex];
      let targetIndex = room.currentPlayerIndex;
      if (act.target === 'next') {
        targetIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
      } else if (act.target === 'previous') {
        targetIndex = (room.currentPlayerIndex - room.direction + room.players.length) % room.players.length;
      } else if (act.target === 'lowest') {
        // Swap with the player holding the lowest number of cards (except active)
        let minCards = 999;
        room.players.forEach((p, idx) => {
          if (idx !== room.currentPlayerIndex && p.cards.length < minCards) {
            minCards = p.cards.length;
            targetIndex = idx;
          }
        });
      }
      
      if (targetIndex !== room.currentPlayerIndex) {
        const targetPlayer = room.players[targetIndex];
        const temp = activePlayer.cards;
        activePlayer.cards = targetPlayer.cards;
        targetPlayer.cards = temp;
        addLog(room, `🔄 Custom Swap! ${activePlayer.name} swapped hands with ${targetPlayer.name}!`);
      }
    } else if (act.type === 'draw_till_color') {
      // The next player will keep drawing cards until they get a card matching room.currentColor
      const nextIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
      const targetPlayer = room.players[nextIndex];
      let drawnCount = 0;
      let cardMatched = false;

      while (!cardMatched && room.deck.length + room.discardPile.length > 1) {
        if (room.deck.length === 0) {
          recycleDiscardPile(room);
        }
        const cardDrawn = room.deck.pop();
        targetPlayer.cards.push(cardDrawn);
        drawnCount++;
        // Check if drawn card matches currentColor or is a wild
        if (cardDrawn.color === room.currentColor || cardDrawn.color === 'wild' || cardDrawn.color === 'wild4') {
          cardMatched = true;
        }
      }
      addLog(room, `🎨 Draw-Till-Color! ${targetPlayer.name} drew ${drawnCount} cards until matching ${room.currentColor}.`);
      skipNext = true;
    }
  });

  // Advance turn
  advanceTurn(room);
  if (skipNext) {
    addLog(room, `${room.players[room.currentPlayerIndex].name} is skipped!`);
    advanceTurn(room);
  }
}

// Draw card helper
function drawCardsForPlayer(room, player, count) {
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) {
      recycleDiscardPile(room);
    }
    if (room.deck.length > 0) {
      player.cards.push(room.deck.pop());
    }
  }
  // If player draws, they lose their UNO! status
  player.unoDeclared = false;
}

// Recycle discard pile when deck runs empty
function recycleDiscardPile(room) {
  if (room.discardPile.length <= 1) return;
  const topCard = room.discardPile.shift(); // Keep top card
  const newDeck = [...room.discardPile];
  room.discardPile = [topCard];
  room.deck = shuffle(newDeck);
  addLog(room, `Deck was empty. Shuffled discard pile back into the deck.`);
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create Room (Host)
  socket.on('create_room', (callback) => {
    const code = generateRoomCode();
    const room = {
      roomCode: code,
      hostSocketId: socket.id,
      players: [],
      status: 'lobby',
      deck: [],
      discardPile: [],
      currentPlayerIndex: 0,
      direction: 1,
      currentColor: '',
      currentValue: '',
      drawStack: 0,
      calledOutPending: false,
      houseRules: {
        stacking: true,
        drawToMatch: false,
        jumpIn: false,
        no2on4: false
      },
      customCards: [],
      logs: []
    };
    rooms.set(code, room);
    socket.join(code);
    addLog(room, `Lobby created! Connect other devices to IP: ${localIP}:${PORT} Room: ${code}`);
    
    callback({
      status: 'ok',
      roomCode: code,
      localIP,
      port: PORT
    });
  });

  // Reconnect Host
  socket.on('reconnect_host', ({ roomCode }, callback) => {
    const upperCode = roomCode ? roomCode.toUpperCase().trim() : '';
    const room = rooms.get(upperCode);

    if (room) {
      // Cancel pending room termination timeout
      if (hostDisconnectTimeouts.has(upperCode)) {
        clearTimeout(hostDisconnectTimeouts.get(upperCode));
        hostDisconnectTimeouts.delete(upperCode);
      }

      room.hostSocketId = socket.id;
      socket.join(upperCode);
      addLog(room, `Host reconnected. Resuming table view.`);
      callback({ status: 'ok', roomCode: upperCode });
      broadcastState(room);
    } else {
      callback({ status: 'error', message: 'Room not found or expired.' });
    }
  });

  // Join Room (Player)
  socket.on('join_room', ({ roomCode, playerName, avatar }, callback) => {
    const upperCode = roomCode ? roomCode.toUpperCase().trim() : '';
    const room = rooms.get(upperCode);

    if (!room) {
      return callback({ status: 'error', message: 'Room not found. Make sure the code is correct.' });
    }

    const trimmedName = (playerName || '').trim();
    // Check if player name already exists in room (reconnect flow)
    const existingPlayer = room.players.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());

    if (existingPlayer) {
      // Reconnect/Resume flow
      existingPlayer.socketId = socket.id;
      existingPlayer.online = true;
      socket.join(upperCode);
      addLog(room, `Player ${existingPlayer.name} reconnected to game.`);
      callback({ status: 'ok', roomCode: upperCode });
      broadcastState(room);
      return;
    }

    // New players cannot join an active match
    if (room.status !== 'lobby') {
      return callback({ status: 'error', message: 'Game has already started in this room.' });
    }

    if (room.players.some(p => p.socketId === socket.id)) {
      return callback({ status: 'error', message: 'You are already in this room.' });
    }

    const player = {
      socketId: socket.id,
      name: trimmedName || `Player ${room.players.length + 1}`,
      avatar: avatar || '🦖',
      cards: [],
      unoDeclared: false,
      online: true
    };

    room.players.push(player);
    socket.join(upperCode);
    addLog(room, `Player ${player.name} joined the game lobby.`);
    
    callback({ status: 'ok', roomCode: upperCode });
    broadcastState(room);
  });

  // Rematch Game (Returns room to lobby and clears stats, letting host start a new match)
  socket.on('rematch', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.status = 'lobby';
    room.discardPile = [];
    room.currentPlayerIndex = 0;
    room.direction = 1;
    room.currentColor = '';
    room.currentValue = '';
    room.drawStack = 0;
    room.calledOutPending = false;
    room.logs = [];

    // Clear hands and reset stats
    room.players.forEach(p => {
      p.cards = [];
      p.unoDeclared = false;
      p.hasWon = false;
      p.rank = null;
    });

    addLog(room, `🔄 Rematch initiated! Room reset to lobby.`);
    broadcastState(room);
    io.to(roomCode).emit('rematch_started');
  });

  // Start Game
  socket.on('start_game', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit('error_message', 'You need at least 2 players to start!');
      return;
    }

    addLog(room, `Starting the game... Shuffling cards...`);
    // 1. Generate and shuffle deck
    room.deck = shuffle(generateDeck(room.customCards));

    // 2. Distribute 7 cards to each player
    room.players.forEach(p => {
      p.cards = [];
      p.unoDeclared = false;
      p.hasWon = false;
      p.rank = null;
      drawCardsForPlayer(room, p, 7);
    });

    // 3. Set up discard pile (first card must not be a Wild / Action if possible)
    let firstCard = room.deck.pop();
    // Keep drawing until a basic card is on top
    const maxTries = 10;
    let tries = 0;
    while ((firstCard.color === 'wild' || firstCard.type === 'action' || firstCard.type === 'custom') && tries < maxTries) {
      room.deck.unshift(firstCard);
      firstCard = room.deck.pop();
      tries++;
    }

    room.discardPile = [firstCard];
    room.currentColor = firstCard.color;
    room.currentValue = firstCard.value;
    room.status = 'playing';
    room.direction = 1;
    room.currentPlayerIndex = 0;
    room.drawStack = 0;
    room.calledOutPending = false;

    addLog(room, `Uno game started! First card is ${firstCard.color.toUpperCase()} ${firstCard.value}.`);
    broadcastState(room);
  });

// Process action triggers for multiple cards played together
function processMultipleCardEffects(cards, room, chosenColor) {
  let skipCount = 0;
  let drawCount = 0;
  let reverseDirectionCount = 0;
  let forceColor = false;
  const customActionList = [];
  
  // The top card (last card in the played array) determines the main visual state
  const mainCard = cards[cards.length - 1];

  cards.forEach(card => {
    if (card.type === 'action') {
      if (card.value === 'skip') {
        skipCount++;
      } else if (card.value === 'reverse') {
        reverseDirectionCount++;
      } else if (card.value === 'draw2') {
        drawCount += 2;
      }
    } else if (card.type === 'wild') {
      forceColor = true;
      if (card.value === 'wild4') {
        drawCount += 4;
      }
    } else if (card.type === 'custom') {
      if (card.actions) {
        customActionList.push(...card.actions);
      }
    }
  });

  // 1. Color resolution: based on main card and chosenColor
  if (forceColor || mainCard.color === 'wild') {
    room.currentColor = chosenColor || 'red';
  } else {
    room.currentColor = mainCard.color;
  }
  room.currentValue = mainCard.value;

  // 2. Reverse resolution
  if (reverseDirectionCount > 0) {
    // If odd number of reverses, change direction
    if (reverseDirectionCount % 2 === 1) {
      if (room.players.length === 2) {
        skipCount += reverseDirectionCount;
      } else {
        room.direction *= -1;
        addLog(room, `Play direction reversed! Now flowing ${room.direction === 1 ? 'clockwise' : 'counter-clockwise'}.`);
      }
    }
  }

  // 3. Stacking vs Draw resolution
  if (drawCount > 0) {
    if (room.houseRules.stacking) {
      room.drawStack += drawCount;
      addLog(room, `Stack increased! Cumulative draw penalty is now +${room.drawStack}.`);
    } else {
      // Immediate draw for next player without stacking
      const nextIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
      const targetPlayer = room.players[nextIndex];
      drawCardsForPlayer(room, targetPlayer, drawCount);
      addLog(room, `${targetPlayer.name} draws ${drawCount} cards.`);
      skipCount++; // Draw penalty skips their turn
    }
  }

  // 4. Custom action processing
  customActionList.forEach(act => {
    if (act.type === 'draw') {
      const count = parseInt(act.count) || 1;
      if (room.houseRules.stacking) {
        room.drawStack += count;
        addLog(room, `Custom Stack! Play +${count} cards. Cumulative stack: +${room.drawStack}.`);
      } else {
        const nextIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
        const targetPlayer = room.players[nextIndex];
        drawCardsForPlayer(room, targetPlayer, count);
        addLog(room, `${targetPlayer.name} draws ${count} cards from custom card.`);
        skipCount++;
      }
    } else if (act.type === 'skip') {
      skipCount++;
    } else if (act.type === 'reverse') {
      if (room.players.length === 2) {
        skipCount++;
      } else {
        room.direction *= -1;
        addLog(room, `Play direction reversed by custom rule!`);
      }
    } else if (act.type === 'choose_color') {
      room.currentColor = chosenColor || 'red';
    } else if (act.type === 'swap') {
      const activePlayer = room.players[room.currentPlayerIndex];
      let targetIndex = room.currentPlayerIndex;
      if (act.target === 'next') {
        targetIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
      } else if (act.target === 'previous') {
        targetIndex = (room.currentPlayerIndex - room.direction + room.players.length) % room.players.length;
      } else if (act.target === 'lowest') {
        let minCards = 999;
        room.players.forEach((p, idx) => {
          if (idx !== room.currentPlayerIndex && p.cards.length < minCards) {
            minCards = p.cards.length;
            targetIndex = idx;
          }
        });
      }
      
      if (targetIndex !== room.currentPlayerIndex) {
        const targetPlayer = room.players[targetIndex];
        const temp = activePlayer.cards;
        activePlayer.cards = targetPlayer.cards;
        targetPlayer.cards = temp;
        addLog(room, `🔄 Custom Swap! ${activePlayer.name} swapped hands with ${targetPlayer.name}!`);
      }
    } else if (act.type === 'draw_till_color') {
      const nextIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
      const targetPlayer = room.players[nextIndex];
      let drawnCount = 0;
      let cardMatched = false;

      while (!cardMatched && room.deck.length + room.discardPile.length > 1) {
        if (room.deck.length === 0) {
          recycleDiscardPile(room);
        }
        const cardDrawn = room.deck.pop();
        targetPlayer.cards.push(cardDrawn);
        drawnCount++;
        if (cardDrawn.color === room.currentColor || cardDrawn.color === 'wild' || cardDrawn.color === 'wild4') {
          cardMatched = true;
        }
      }
      addLog(room, `🎨 Draw-Till-Color! ${targetPlayer.name} drew ${drawnCount} cards until matching ${room.currentColor}.`);
      skipCount++;
    }
  });

  // Advance turn
  advanceTurn(room);
  
  // Apply skips
  for (let i = 0; i < skipCount; i++) {
    addLog(room, `${room.players[room.currentPlayerIndex].name} is skipped!`);
    advanceTurn(room);
  }
}

  // Play Card
  socket.on('play_card', ({ roomCode, cardId, cardIds, chosenColor }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];
    if (player.hasWon) return socket.emit('error_message', 'You have already finished playing!');
    const cardsToPlay = [];

    if (cardIds && Array.isArray(cardIds) && cardIds.length > 0) {
      // Multiple cards throwing
      for (const id of cardIds) {
        const card = player.cards.find(c => c.id === id);
        if (!card) return socket.emit('error_message', 'Player does not have all selected cards.');
        cardsToPlay.push(card);
      }
      
      const val = cardsToPlay[0].value;
      const allSameValue = cardsToPlay.every(c => c.value === val);
      if (!allSameValue) {
        return socket.emit('error_message', 'All thrown cards must have the same number/value.');
      }
    } else if (cardId) {
      // Single card play
      const card = player.cards.find(c => c.id === cardId);
      if (!card) return socket.emit('error_message', 'Player does not have the selected card.');
      cardsToPlay.push(card);
    } else {
      return socket.emit('error_message', 'No card selected to play.');
    }

    // Check if it is player's turn (unless jump-in house rule is active)
    let isTurn = room.currentPlayerIndex === playerIndex;
    let isJumpIn = false;

    if (!isTurn) {
      if (room.houseRules.jumpIn) {
        const topCard = room.discardPile[0];
        const jumpInCard = cardsToPlay.find(c => topCard && c.color === room.currentColor && c.value === room.currentValue && c.color !== 'wild');
        if (jumpInCard) {
          isJumpIn = true;
          room.currentPlayerIndex = playerIndex;
          addLog(room, `⚡ Jump-In! ${player.name} played out of turn.`);
        } else {
          return socket.emit('error_message', 'It is not your turn, and none of your selected cards is an exact match for Jump-In.');
        }
      } else {
        return socket.emit('error_message', 'It is not your turn.');
      }
    }

    // Validate play logic for set
    if (room.houseRules.stacking && room.drawStack > 0) {
      const allStackable = cardsToPlay.every(c => {
        if (room.houseRules.no2on4 && room.currentValue === 'wild4' && c.value === 'draw2') {
          return false;
        }
        if (c.value === 'draw2' || c.value === 'wild4') return true;
        if (c.type === 'custom' && c.actions.some(a => a.type === 'draw')) return true;
        return false;
      });
      if (!allStackable) {
        return socket.emit('error_message', 'You must play stackable Draw cards (+2, +4, custom draw) during an active penalty! Note that +2 cannot stack on +4.');
      }
    }

    const hasValidAnchor = cardsToPlay.some(c => isValidPlay(c, room, playerIndex));
    if (!hasValidAnchor) {
      return socket.emit('error_message', 'None of the selected cards matches the current discard pile color or value.');
    }

    // Perform play
    cardsToPlay.forEach(card => {
      const idx = player.cards.findIndex(c => c.id === card.id);
      player.cards.splice(idx, 1);
    });

    cardsToPlay.forEach(card => {
      room.discardPile.unshift(card);
    });

    const topCard = cardsToPlay[cardsToPlay.length - 1];

    if (cardsToPlay.length > 1) {
      addLog(room, `${player.name} played a MULTIPLE of same value: ${cardsToPlay.map(c => `${c.color.toUpperCase()} ${c.value}`).join(', ')}.`);
    } else {
      addLog(room, `${player.name} played ${topCard.color === 'wild' ? 'Wild' : topCard.color.toUpperCase()} ${topCard.value}.`);
    }

    // Reset UNO yell status if they have more than 1 card
    if (player.cards.length > 1) {
      player.unoDeclared = false;
    }

    // Turn resolution & Winner check
    if (player.cards.length === 0) {
      player.hasWon = true;
      const numFinished = room.players.filter(p => p.hasWon).length;
      player.rank = numFinished;
      addLog(room, `👑 ${player.name} finished at Rank #${player.rank}!`);
      
      const activePlayers = room.players.filter(p => !p.hasWon);
      if (activePlayers.length <= 1) {
        if (activePlayers.length === 1) {
          activePlayers[0].hasWon = true;
          activePlayers[0].rank = room.players.length;
          addLog(room, `🏁 ${activePlayers[0].name} takes the final Rank #${activePlayers[0].rank}.`);
        }
        
        room.status = 'gameover';
        
        const standings = [...room.players]
          .sort((a, b) => (a.rank || 99) - (b.rank || 99))
          .map(p => ({ name: p.name, rank: p.rank || 99 }));
          
        broadcastState(room);
        io.to(roomCode).emit('game_over_announcement', { winner: standings[0].name, standings });
        return;
      }
    }

    // Uno Yell handling
    if (player.cards.length === 1 && !player.unoDeclared) {
      room.calledOutPending = true;
      addLog(room, `⚠️ ${player.name} has 1 card left but hasn't yelled UNO!`);
    } else {
      room.calledOutPending = false;
    }

    // Process action triggers
    processMultipleCardEffects(cardsToPlay, room, chosenColor);
    broadcastState(room);
  });

  // Draw Card
  socket.on('draw_card', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex === -1 || room.currentPlayerIndex !== playerIndex) return;

    const player = room.players[playerIndex];
    if (player.hasWon) return;

    // If there is a cumulative drawStack penalty (stacking rule)
    if (room.drawStack > 0) {
      const penalty = room.drawStack;
      drawCardsForPlayer(room, player, penalty);
      room.drawStack = 0;
      addLog(room, `${player.name} drew penalty of ${penalty} cards.`);
      advanceTurn(room);
      broadcastState(room);
      return;
    }

    // Regular draw
    let drewPlayable = false;
    if (room.houseRules.drawToMatch) {
      // Draw until player finds a playable card
      let drewPlayableTemp = false;
      let drawnCount = 0;
      while (!drewPlayableTemp && room.deck.length + room.discardPile.length > 1) {
        if (room.deck.length === 0) {
          recycleDiscardPile(room);
        }
        const cardDrawn = room.deck.pop();
        player.cards.push(cardDrawn);
        drawnCount++;
        if (isValidPlay(cardDrawn, room, playerIndex)) {
          drewPlayableTemp = true;
          drewPlayable = true;
        }
      }
      addLog(room, `${player.name} drew ${drawnCount} cards until matching.`);
    } else {
      // Draw standard single card
      if (room.deck.length === 0) {
        recycleDiscardPile(room);
      }
      const card = room.deck.pop();
      player.cards.push(card);
      addLog(room, `${player.name} drew standard card.`);
      if (isValidPlay(card, room, playerIndex)) {
        drewPlayable = true;
      }
    }

    // If they drew a playable card, don't auto-advance the turn so they can play it!
    if (drewPlayable) {
      addLog(room, `${player.name} drew a playable card and has the option to play it.`);
      broadcastState(room);
    } else {
      // Auto-advance if not playable
      advanceTurn(room);
      broadcastState(room);
    }
  });

  // Pass Turn (optional: if they draw a card and want to pass, though our regular draw auto-passes)
  socket.on('pass_turn', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex === -1 || room.currentPlayerIndex !== playerIndex) return;

    const player = room.players[playerIndex];
    if (player.hasWon) return;

    addLog(room, `${player.name} passed their turn.`);
    advanceTurn(room);
    broadcastState(room);
  });

  // Declare UNO
  socket.on('declare_uno', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    player.unoDeclared = true;
    addLog(room, `📣 ${player.name} shouted UNO!`);
    io.to(roomCode).emit('uno_notification', { message: `${player.name} shouted UNO!` });
    broadcastState(room);
  });

  // Call Out Player (for forgetting UNO) - anyone can catch at any time
  socket.on('call_out_uno', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    // Find the vulnerable player (has exactly 1 card, not declared uno)
    const vulnerablePlayer = room.players.find(p => p.cards.length === 1 && !p.unoDeclared);
    const caller = room.players.find(p => p.socketId === socket.id) || { name: 'Host' };

    if (vulnerablePlayer) {
      drawCardsForPlayer(room, vulnerablePlayer, 2);
      room.calledOutPending = false;
      addLog(room, `🚨 ${caller.name} caught ${vulnerablePlayer.name} with 1 card! ${vulnerablePlayer.name} draws 2 cards penalty.`);
      io.to(roomCode).emit('uno_notification', { message: `${caller.name} caught ${vulnerablePlayer.name}! Drawn +2 cards!` });
      broadcastState(room);
    }
  });

  // Add Custom Card
  socket.on('add_custom_card', ({ roomCode, card }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.customCards.push(card);
    addLog(room, `✨ Custom Card Added: "${card.name}" [${card.color.toUpperCase()}] Qty: ${card.qty || 2}`);
    broadcastState(room);
  });

  // Toggle House Rule
  socket.on('toggle_house_rule', ({ roomCode, rule, value }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.houseRules.hasOwnProperty(rule)) {
      room.houseRules[rule] = value;
      addLog(room, `⚙️ Rule Changed: ${rule} is now ${value ? 'ENABLED' : 'DISABLED'}`);
      broadcastState(room);
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    for (const [code, room] of rooms.entries()) {
      // 1. Host Disconnect Grace Period
      if (room.hostSocketId === socket.id) {
        addLog(room, `Host disconnected. Waiting 60s for host to reconnect...`);
        
        const timeoutId = setTimeout(() => {
          addLog(room, `Host connection lost permanently. Closing room.`);
          io.to(code).emit('room_closed', 'Host connection has been lost.');
          rooms.delete(code);
          hostDisconnectTimeouts.delete(code);
        }, 60000);
        
        hostDisconnectTimeouts.set(code, timeoutId);
        continue;
      }

      // 2. Player Disconnect
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        
        if (room.status === 'playing') {
          // Keep player in the match, just mark offline so they can refresh/reconnect
          player.online = false;
          addLog(room, `Player ${player.name} went offline.`);
          broadcastState(room);
        } else {
          // If still in lobby, remove them immediately
          room.players.splice(playerIndex, 1);
          addLog(room, `Player ${player.name} left the lobby.`);
          broadcastState(room);
        }
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on IP: ${localIP}:${PORT}`);
});
