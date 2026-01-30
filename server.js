const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*" }
});

const db = new sqlite3.Database(':memory:');

// База данных
db.serialize(() => {
  db.run(`CREATE TABLE users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL
  )`);
  
  // Тестовые пользователи
  const hash1 = crypto.createHash('sha256').update('123').digest('hex');
  const hash2 = crypto.createHash('sha256').update('password').digest('hex');
  
  db.run('INSERT OR IGNORE INTO users VALUES (?, ?, ?)', ['test', hash1, 'Тест']);
  db.run('INSERT OR IGNORE INTO users VALUES (?, ?, ?)', ['test1', hash2, 'Тест 1']);
});

const activeUsers = new Map();

io.on('connection', (socket) => {
  console.log('✅ Подключен:', socket.id);
  
  // Вход
  socket.on('login', ({ username, password }) => {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    db.get('SELECT name FROM users WHERE username = ? AND password_hash = ?', 
      [username, hash], (err, row) => {
        if (err || !row) {
          socket.emit('auth-error', 'Неверный логин или пароль');
          return;
        }
        
        socket.username = username;
        activeUsers.set(username, socket.id);
        
        socket.emit('auth-success', {
          name: row.name,
          avatar: ''
        });
        
        console.log('✅ Вход:', username);
    });
  });
  
  // Регистрация
  socket.on('register', ({ name, username, password }) => {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (row) {
        socket.emit('auth-error', 'Пользователь уже существует');
        return;
      }
      
      db.run('INSERT INTO users VALUES (?, ?, ?)', [username, hash, name], (err) => {
        if (err) {
          socket.emit('auth-error', 'Ошибка регистрации');
          return;
        }
        
        socket.emit('auth-success', { name, avatar: '' });
        console.log('✅ Регистрация:', username);
      });
    });
  });
  
  // Присоединение к комнате
  socket.on('join-room', ({ room, peerId, name }) => {
    console.log(`👤 ${name} в комнате ${room}`);
    
    socket.join(room);
    socket.currentRoom = room;
    socket.peerId = peerId;
    
    // Отправляем новичку список участников
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (roomSockets) {
      roomSockets.forEach(socketId => {
        if (socketId !== socket.id) {
          const otherSocket = io.sockets.sockets.get(socketId);
          if (otherSocket && otherSocket.peerId) {
            socket.emit('user-joined', {
              peerId: otherSocket.peerId,
              name: otherSocket.username || 'Участник'
            });
          }
        }
      });
    }
    
    // Уведомляем других
    socket.to(room).emit('user-joined', {
      peerId,
      name: name || socket.username || 'Участник'
    });
  });
  
  // WebRTC сигналы
  socket.on('webrtc-offer', ({ to, from, offer }) => {
    const recipient = activeUsers.get(to);
    if (recipient) io.to(recipient).emit('webrtc-offer', { from, offer });
  });
  
  socket.on('webrtc-answer', ({ to, from, answer }) => {
    const recipient = activeUsers.get(to);
    if (recipient) io.to(recipient).emit('webrtc-answer', { from, answer });
  });
  
  socket.on('webrtc-ice-candidate', ({ to, from, candidate }) => {
    const recipient = activeUsers.get(to);
    if (recipient) io.to(recipient).emit('webrtc-ice-candidate', { from, candidate });
  });
  
  // Сообщения
  socket.on('chat-message', ({ room, name, text }) => {
    io.to(room).emit('chat-message', {
      name,
      text,
      timestamp: new Date().toISOString()
    });
  });
  
  // Отключение
  socket.on('disconnect', () => {
    if (socket.username) {
      activeUsers.delete(socket.username);
    }
    
    if (socket.currentRoom && socket.peerId) {
      socket.to(socket.currentRoom).emit('user-left', {
        peerId: socket.peerId
      });
    }
  });
});

app.use(express.static('.'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});