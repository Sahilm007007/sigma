// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

// Serve static files from the "public" folder.
app.use(express.static('public'));

// Global game state.
let players = {}; // keyed by socket.id: { id, name, position, radius, volume, speed, texture }
let planets = []; // array of planet objects
let boosts = [];  // array of boost pellet objects
let watchers = []; // array of watcher pellets

// Helper: returns a random color (for planets).
function getRandomColor() {
  const colors = [0xff6b6b, 0xfeca57, 0x48dbfb, 0x1dd1a1, 0x5f27cd];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Helper: spawn a planet.
function spawnPlanet() {
  let radius = 10 + Math.random() * 20; // planet radius between 10 and 30
  let volume = (4 / 3) * Math.PI * Math.pow(radius, 3);
  return {
    id: Math.random().toString(36).substr(2, 9),
    position: {
      x: (Math.random() - 0.5) * 4000,
      y: (Math.random() - 0.5) * 4000,
      z: (Math.random() - 0.5) * 4000
    },
    radius: radius,
    volume: volume,
    color: getRandomColor(),
    type: "planet"
  };
}

// Helper: spawn a speed boost pellet.
function spawnBoostPellet() {
  let radius = 20; // fixed boost pellet size
  return {
    id: Math.random().toString(36).substr(2, 9),
    position: {
      x: (Math.random() - 0.5) * 4000,
      y: (Math.random() - 0.5) * 4000,
      z: (Math.random() - 0.5) * 4000
    },
    radius: radius,
    speedBoost: 50, // permanently increase speed by 50
    type: "boost"
  };
}

// Helper: spawn a watcher pellet.
function spawnWatcher() {
  let radius = 20; // choose a radius; collision detection uses this value
  return {
    id: Math.random().toString(36).substr(2, 9),
    position: {
      x: (Math.random() - 0.5) * 4000,
      y: (Math.random() - 0.5) * 4000,
      z: (Math.random() - 0.5) * 4000
    },
    radius: radius,
    type: "watcher"
  };
}

// Spawn initial objects.
for (let i = 0; i < 100; i++) {
  planets.push(spawnPlanet());
}
for (let i = 0; i < 20; i++) {
  boosts.push(spawnBoostPellet());
}
while (watchers.length < 3) {
  watchers.push(spawnWatcher());
}

// When a client connects...
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  // Use a bigger spawn size: radius 60.
  let spawnRadius = 60;
  let spawnVolume = (4 / 3) * Math.PI * Math.pow(spawnRadius, 3);
  players[socket.id] = {
    id: socket.id,
    name: "Anonymous",
    position: {
      x: (Math.random() - 0.5) * 1000,
      y: (Math.random() - 0.5) * 1000,
      z: (Math.random() - 0.5) * 1000
    },
    radius: spawnRadius,
    volume: spawnVolume,
    speed: 300,          // default speed
    texture: "1.jpg"     // default texture
  };

  // Listen for the player's name and texture.
  socket.on('setName', (data) => {
    if (players[socket.id]) {
      players[socket.id].name = data.name || "Anonymous";
      players[socket.id].texture = data.texture || "1.jpg";
    }
  });

  // Send the new player its ID and the current game state.
  socket.emit('init', { id: socket.id, players, planets, boosts, watchers });

  // Receive movement input.
  socket.on('playerInput', (data) => {
    if (players[socket.id]) {
      let speed = players[socket.id].speed;
      players[socket.id].position.x += data.moveVector.x * speed * data.delta;
      players[socket.id].position.y += data.moveVector.y * speed * data.delta;
      players[socket.id].position.z += data.moveVector.z * speed * data.delta;
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete players[socket.id];
  });
});

// Server game loop (20 updates/sec, every 50ms).
setInterval(() => {
  // 1. Check collisions: players vs. planets.
  for (let id in players) {
    let player = players[id];
    for (let i = planets.length - 1; i >= 0; i--) {
      let planet = planets[i];
      let dx = player.position.x - planet.position.x;
      let dy = player.position.y - planet.position.y;
      let dz = player.position.z - planet.position.z;
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < player.radius + planet.radius) {
        player.volume += planet.volume;
        player.radius = Math.cbrt((3 * player.volume) / (4 * Math.PI));
        planets.splice(i, 1);
        planets.push(spawnPlanet());
      }
    }
  }

  // 2. Check collisions: players vs. boost pellets.
  for (let id in players) {
    let player = players[id];
    for (let i = boosts.length - 1; i >= 0; i--) {
      let boost = boosts[i];
      let dx = player.position.x - boost.position.x;
      let dy = player.position.y - boost.position.y;
      let dz = player.position.z - boost.position.z;
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < player.radius + boost.radius) {
        player.speed += boost.speedBoost;
        boosts.splice(i, 1);
        boosts.push(spawnBoostPellet());
      }
    }
  }

  // 3. Check collisions: players vs. watcher pellets.
  for (let id in players) {
    let player = players[id];
    for (let i = watchers.length - 1; i >= 0; i--) {
      let watcher = watchers[i];
      let dx = player.position.x - watcher.position.x;
      let dy = player.position.y - watcher.position.y;
      let dz = player.position.z - watcher.position.z;
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < player.radius + watcher.radius) {
        player.volume += 30;
        player.radius = Math.cbrt((3 * player.volume) / (4 * Math.PI));
        watchers.splice(i, 1);
        watchers.push(spawnWatcher());
      }
    }
  }
  // Ensure there are always 3 watchers.
  while (watchers.length < 3) {
    watchers.push(spawnWatcher());
  }

  // 4. Check collisions: player vs. player.
  const playerIds = Object.keys(players);
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const p1 = players[playerIds[i]];
      const p2 = players[playerIds[j]];
      let dx = p1.position.x - p2.position.x;
      let dy = p1.position.y - p2.position.y;
      let dz = p1.position.z - p2.position.z;
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < p1.radius + p2.radius) {
        if (p1.radius > p2.radius * 1.1) {
          p1.volume += p2.volume;
          p1.radius = Math.cbrt((3 * p1.volume) / (4 * Math.PI));
          let defaultVolume = (4 / 3) * Math.PI * Math.pow(60, 3);
          players[p2.id].position = {
            x: (Math.random() - 0.5) * 1000,
            y: (Math.random() - 0.5) * 1000,
            z: (Math.random() - 0.5) * 1000
          };
          players[p2.id].volume = defaultVolume;
          players[p2.id].radius = 60;
          players[p2.id].speed = 300;
        } else if (p2.radius > p1.radius * 1.1) {
          p2.volume += p1.volume;
          p2.radius = Math.cbrt((3 * p2.volume) / (4 * Math.PI));
          let defaultVolume = (4 / 3) * Math.PI * Math.pow(60, 3);
          players[p1.id].position = {
            x: (Math.random() - 0.5) * 1000,
            y: (Math.random() - 0.5) * 1000,
            z: (Math.random() - 0.5) * 1000
          };
          players[p1.id].volume = defaultVolume;
          players[p1.id].radius = 60;
          players[p1.id].speed = 300;
        }
      }
    }
  }

  // 5. Broadcast the updated game state.
  io.sockets.emit('gameState', { players, planets, boosts, watchers });
}, 50);

http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
