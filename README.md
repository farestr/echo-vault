# Echo Vault — Co-op Puzzle Game

Production-ready Node.js multiplayer puzzle game for two players.

## Requirements
- Node.js 18+
- A server that supports WebSockets (VPS, Render, Railway, Fly.io, etc.)

## Deploy
```bash
npm install
npm start
```

Set `PORT` if your host provides one. The app serves the frontend and WebSocket endpoint from the same process, so there is no separate API configuration.

Open the public URL in two browsers/devices. Player 1 creates a vault and shares the six-character code with Player 2.

## Reverse proxy
If using Nginx/Apache, proxy both normal HTTP traffic and WebSocket upgrade requests to the Node process. Example Nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

## Structure
- `server.js` — HTTP server, WebSocket multiplayer, room state and puzzle validation
- `public/index.html` — game UI
- `public/style.css` — premium visual system
- `public/app.js` — client multiplayer/game logic

Rooms are intentionally in-memory for this version. Restarting the process clears active rooms.
