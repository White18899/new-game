# UNO CONNECT 🦖

Uno Connect is a real-time, local-network multiplayer card game based on Uno, featuring custom house rules, a custom card designer, and synthetic audio synthesis. It is designed to be played on a shared central screen (like a TV or monitor) while players interact using their own mobile devices as private game pads.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** (v18.0.0 or higher recommended)
* A local network connection (Wi-Fi) so players can connect to the host's server IP from their mobile devices.

### Installation
1. Clone the repository and navigate to the project directory:
   ```bash
   cd new-game
   ```
2. Install the package dependencies:
   ```bash
   npm install
   ```

### Running the Server
Start the server using npm:
```bash
npm start
```
By default, the server runs on port **`3000`**. 

When the server starts, it automatically detects your local network IP. The host interface will display the URL (e.g., `http://192.168.1.X:3000`) that players on the same Wi-Fi network should enter in their web browsers to join the lobby.

---

## 🛠️ Technology Stack

* **Server/Backend**:
  * [Node.js](https://nodejs.org/) - Runtime environment
  * [Express](https://expressjs.com/) - Serves the web assets from the [public/](file:///a:/new-game/public) directory
  * [Socket.io](https://socket.io/) - Drives the real-time, bi-directional event pipeline for gameplay actions
* **Client/Frontend**:
  * **HTML5 & CSS3** - Modern, custom, responsive interface styling with glassmorphism panels (without heavy CSS frameworks)
  * **Vanilla Javascript** - Game rendering, event registration, and DOM updating
  * **Web Audio API** - Synthesizes game sounds dynamically in real time (located in [public/js/sound.js](file:///a:/new-game/public/js/sound.js)), eliminating static audio asset downloads
  * **Three.js** - Includes custom WebGL color gradient shader backgrounds (located in [public/js/color-bends.js](file:///a:/new-game/public/js/color-bends.js))

### 📊 Technology Mapping per Gameplay Step

To see how these technologies align with the gameplay phases:

| Step | Focus Area | Core Technologies / APIs Used |
| :--- | :--- | :--- |
| **Step 1: Setting up Host** | UI Hosting & State Init | Node.js, Express, HTML5, Vanilla CSS (Glassmorphism design), JavaScript |
| **Step 2: Players Join** | WebSocket Handshake | Socket.io (WebSocket protocol), SessionStorage |
| **Step 3: Creating Custom Cards** | Form Data Transmission | HTML5 forms, Vanilla JS DOM updates, Socket.io, Node.js state array |
| **Step 4: Customizing & Starting**| Shuffle & Dealing | Node.js, Socket.io broadcasts, Fisher-Yates shuffle algorithm |
| **Step 5: The Game Loop** | Real-time state updates | Socket.io targeting (socket IDs/rooms), Node.js state machine, JSON |
| **Step 6: Playing Cards** | Interactions & Sound | Vanilla JS event listeners, Socket.io, Web Audio API (Synthesized SFX) |
| **Step 7: Declaring Winner** | UI Overlays & Standing | CSS3 Keyframes (alerts/modals), Web Audio API (Chime sound synthesis) |

---

## 🎮 Game Architecture

The application splits gameplay roles across two client views:

1. **Host Central Table (`host.html`)**
   * Acts as the shared display/table.
   * Renders player avatars arranged radially, the current direction of play, the central discard pile, and logs.
   * Features a **Custom Card Creator** where new cards can be added dynamically to the active deck.
   * Configures target house rules before starting a match.

2. **Player Game Boards (`player.html`)**
   * Serves as the player's personal controller.
   * Shows only the player's private hand.
   * Allows drawing, playing cards, selecting wild colors, picking players for hand swaps, and shouting **"UNO!"**.

3. **Lobby Gateway (`index.html`)**
   * Serves as the landing page to choose between starting a new Host room or entering a 4-letter room code to join an existing game.

---

## 🔄 How Everything Works (Step-by-Step Flow)

Here is a human-readable, step-by-step breakdown of how the game's network, server, and client screens coordinate:

*   **Step 1: Setting up the Host Board**
    * One main device (like a laptop, PC, or smart TV browser) hosts the central table by opening [index.html](file:///a:/new-game/public/index.html) and clicking **"Host Central Table"**.
    * The server generates a unique, 4-character room code (e.g. `ABCD`) and initializes an in-memory game room structure containing rules, logs, deck arrays, and player lists.
*   **Step 2: Players Join the Game**
    * Other players connect their phones/tablets to the same Wi-Fi network and open the host's server URL in their browsers.
    * They type their names, select a game avatar, enter the 4-letter room code, and hit **"Join Room"**.
    * Socket.io establishes a persistent WebSocket connection between each player's client and the server.
*   **Step 3: Creating Custom Cards (Optional)**
    * Before the match begins, the Host can use the **Custom Card Creator** panel on the central screen to design brand new card types. 
    * These custom cards support custom symbols, background colors, and chainable action behaviors (such as skip, reverse, draw-penalty count, swapping decks, or drawing until a specific color is found).
    * When saved, the server dynamically injects copies of these custom cards into the room's card deck database.
*   **Step 4: Customizing Rules & Starting**
    * The Host toggles specific house rules (e.g., stacking penalties or out-of-turn jump-ins) on the central screen and clicks **"Start Game"**.
    * The server compiles the standard deck + custom cards, runs a Fisher-Yates shuffle algorithm, deals 7 private cards to each player's socket, sets up the starting card in the discard pile, and turns on the play flow.
*   **Step 5: The Game Loop & Broadcasting State**
    * The server acts as the absolute source of truth. It manages current turn indices, active colors, draw stacks, and connection statuses.
    * Every time a game action occurs, the server sends a customized state update:
        * The **Host Central Screen** receives public data only (discard pile card, logs, whose turn it is, and card counts for each player).
        * Each **Player Screen** receives private data (their own cards, indicators if it's their turn, and general indicators of other players' ranks and hand sizes).
*   **Step 6: Playing Cards & Applying Penalties**
    * When it is a player's turn, their gamepad controls unlock. When they click to throw a valid card, a socket message is sent to the server.
    * The server verifies the play. If valid, the card is placed on top of the discard pile, card effects (like skip, reverse, or hand swaps) are processed, and the turn advances.
    * If stacking is active and draw cards (`+2`/`+4`) are played, the draw penalty builds up. The next player must either counter with another draw card or draw the cumulative total from the deck.
*   **Step 7: Declaring Uno & Hand Winner**
    * When down to 2 cards, a player must shout **"UNO!"** by clicking the button on their screen as they play their next-to-last card. If they forget, other players can hit a callout trigger to penalize them with 2 cards.
    * Once a player plays their final card, they finish and are assigned a standing. The game continues for other players until the round is over or the Host resets the game board.

---

## ⚙️ Custom Mechanics & House Rules

### House Rules (Host Configurable)
* **Stacking**: Allows stacking `+2` or `+4` cards to accumulate penalties for the next player.
* **Draw to Match**: Players keep drawing from the deck until they find a playable card.
* **Jump In**: Play out of turn if you hold a card matching the exact color and symbol on top of the discard pile.
* **No +2 on +4**: Disallows stacking a weaker `+2` draw penalty card on top of a `+4` wild card.

### Custom Card Creator
Hosts can construct brand-new cards and inject multiple copies directly into the deck:
* Set name, symbol, background color (red, blue, yellow, green, wild), and count.
* Attach chainable actions like:
  * `draw`: Specify a custom number of cards to draw.
  * `skip` / `reverse`: Skip turns or reverse direction.
  * `choose_color`: Force color swaps.
  * `swap`: Swap hand contents with the next, previous, lowest-card, or explicitly chosen player.
  * `draw_till_color`: Forces a player to draw cards repeatedly until they draw a card matching the active color.

---

## 📁 File Structure

* [server.js](file:///a:/new-game/server.js) - Standard Node/Express/Socket.io setup containing full in-memory game state handling, Fisher-Yates deck shuffling, action processing, and room controls.
* [public/index.html](file:///a:/new-game/public/index.html) - Entry landing page.
* [public/host.html](file:///a:/new-game/public/host.html) - Host display table layout.
* [public/player.html](file:///a:/new-game/public/player.html) - Player gamepad layout.
* [public/js/](file:///a:/new-game/public/js/) - Client-side controllers:
  * [host.js](file:///a:/new-game/public/js/host.js) - Updates table layouts, room states, custom card arrays, and listens to host-specific socket channels.
  * [player.js](file:///a:/new-game/public/js/player.js) - Updates individual hands, user interactive selectors, turn notifications, and player-side events.
  * [sound.js](file:///a:/new-game/public/js/sound.js) - Sound manager synthesizing custom audio cues via Web Audio API.
  * [color-bends.js](file:///a:/new-game/public/js/color-bends.js) - WebGL wave background rendering component using Three.js.
* [public/css/](file:///a:/new-game/public/css/) - Responsive CSS files:
  * [shared.css](file:///a:/new-game/public/css/shared.css) - Universal layouts, glass panels, buttons, and custom fonts.
  * [host.css](file:///a:/new-game/public/css/host.css) - CSS specific to the host UI.
  * [player.css](file:///a:/new-game/public/css/player.css) - CSS specific to mobile card-playing views.
