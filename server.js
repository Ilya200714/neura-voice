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

// Простая база данных
db.serialize(() => {
  db.run(`
    CREATE TABLE users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL
    )
  `);
  
  // Тестовые пользователи
  const testHash = crypto.createHash('sha256').update('123').digest('hex');
  const test1Hash = crypto.createHash('sha256').update('password').digest('hex');
  
  db.run('INSERT OR IGNORE INTO users VALUES (?, ?, ?)', ['test', testHash, 'Тест Пользователь']);
  db.run('INSERT OR IGNORE INTO users VALUES (?, ?, ?)', ['test1', test1Hash, 'Тест Пользователь 1']);
});

const activeUsers = new Map();

io.on('connection', (socket) => {
  console.log('✅ Новое подключение:', socket.id);
  
  // Вход
  socket.on('login', ({ username, password }) => {
    console.log('🔑 Попытка входа:', username);
    
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
        
        console.log('✅ Успешный вход:', username);
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
      });
    });
  });
  
  // Присоединение к комнате
  socket.on('join-room', ({ room, peerId, name }) => {
    console.log(`👤 ${name} присоединяется к комнате ${room}`);
    
    socket.join(room);
    socket.currentRoom = room;
    socket.peerId = peerId;
    
    // Отправляем текущим участникам информацию о новичке
    socket.to(room).emit('user-joined', {
      peerId: peerId,
      name: name || socket.username || 'Участник'
    });
    
    // Отправляем новичку информацию о текущих участниках
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
  });
  
  // WebRTC сигналы
  socket.on('webrtc-offer', (data) => {
    const recipient = activeUsers.get(data.to);
    if (recipient) {
      io.to(recipient).emit('webrtc-offer', {
        from: data.from,
        offer: data.offer
      });
    }
  });
  
  socket.on('webrtc-answer', (data) => {
    const recipient = activeUsers.get(data.to);
    if (recipient) {
      io.to(recipient).emit('webrtc-answer', {
        from: data.from,
        answer: data.answer
      });
    }
  });
  
  socket.on('webrtc-ice-candidate', (data) => {
    const recipient = activeUsers.get(data.to);
    if (recipient) {
      io.to(recipient).emit('webrtc-ice-candidate', {
        from: data.from,
        candidate: data.candidate
      });
    }
  });
  
  // Сообщения в чате
  socket.on('chat-message', ({ room, name, text }) => {
    io.to(room).emit('chat-message', {
      name: name,
      text: text,
      timestamp: new Date().toISOString()
    });
  });
  
  // Отключение
  socket.on('disconnect', () => {
    console.log('❌ Отключение:', socket.id, socket.username);
    
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

// Статические файлы
app.use(express.static('.'));

// Проверка сервера
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    users: activeUsers.size,
    time: new Date().toISOString()
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`📊 /health - проверка сервера`);
  console.log(`\n📋 Тестовые пользователи:`);
  console.log(`   👤 Логин: test / Пароль: 123`);
  console.log(`   👤 Логин: test1 / Пароль: password`);
});