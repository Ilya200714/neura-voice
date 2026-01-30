const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройки CORS для Socket.io
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// База данных
const db = new sqlite3.Database(':memory:');

// Инициализация базы данных
function initDatabase() {
  // Пользователи
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating users table:', err);
  });

  // Друзья
  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1 TEXT NOT NULL,
      user2 TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      requested_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating friends table:', err);
  });

  // Группы
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      creator TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating groups table:', err);
  });

  // Сообщения групп
  db.run(`
    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT,
      username TEXT,
      message TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating group_messages table:', err);
  });

  // Участники групп
  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT,
      username TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, username)
    )
  `, (err) => {
    if (err) console.error('Error creating group_members table:', err);
  });

  // Тестовый пользователь
  const testHash = crypto.createHash('sha256').update('123').digest('hex');
  db.run(
    'INSERT OR IGNORE INTO users (username, password_hash, name) VALUES (?, ?, ?)',
    ['test', testHash, 'Тестовый пользователь'],
    (err) => {
      if (err) console.error('Error creating test user:', err);
    }
  );
}

initDatabase();

// Хранилище для активных пользователей
const activeUsers = new Map();

// Socket.io события
io.on('connection', (socket) => {
  console.log('✅ Новое подключение:', socket.id);

  // Регистрация
  socket.on('register', ({ name, username, password }) => {
    console.log('👤 Регистрация:', username);
    
    if (!name || !username || !password) {
      return socket.emit('auth-error', 'Заполните все поля');
    }
    
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('❌ Ошибка базы данных:', err);
        return socket.emit('auth-error', 'Ошибка сервера');
      }
      
      if (row) {
        return socket.emit('auth-error', 'Пользователь уже существует');
      }
      
      db.run(
        'INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)',
        [username, hash, name],
        (err) => {
          if (err) {
            console.error('❌ Ошибка создания пользователя:', err);
            return socket.emit('auth-error', 'Ошибка регистрации');
          }
          
          console.log('✅ Пользователь зарегистрирован:', username);
          socket.emit('auth-success', {
            name: name,
            avatar: ''
          });
        }
      );
    });
  });

  // Вход
  socket.on('login', ({ username, password }) => {
    console.log('🔑 Вход:', username);
    
    if (!username || !password) {
      return socket.emit('auth-error', 'Заполните все поля');
    }
    
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    db.get(
      'SELECT name, avatar FROM users WHERE username = ? AND password_hash = ?',
      [username, hash],
      (err, row) => {
        if (err) {
          console.error('❌ Ошибка базы данных:', err);
          return socket.emit('auth-error', 'Ошибка сервера');
        }
        
        if (!row) {
          return socket.emit('auth-error', 'Неверный логин или пароль');
        }
        
        // Сохраняем информацию о пользователе
        socket.username = username;
        socket.userData = row;
        activeUsers.set(username, socket.id);
        
        console.log('✅ Пользователь вошел:', username);
        
        // Отправляем успешный ответ
        socket.emit('auth-success', {
          name: row.name,
          avatar: row.avatar || ''
        });
        
        // Отправляем список друзей
        sendFriendsList(socket, username);
        
        // Отправляем список групп
        sendUserGroups(socket, username);
        
        // Отправляем запросы дружбы
        sendFriendRequests(socket, username);
      }
    );
  });

  // Обновление профиля
  socket.on('update-profile', ({ name, avatar }) => {
    if (!socket.username) return;
    
    db.run(
      'UPDATE users SET name = ?, avatar = ? WHERE username = ?',
      [name, avatar, socket.username],
      (err) => {
        if (err) {
          console.error('Ошибка обновления профиля:', err);
          return;
        }
        
        socket.userData.name = name;
        socket.userData.avatar = avatar;
        
        socket.emit('profile-updated', { name, avatar });
      }
    );
  });

  // Присоединение к комнате голосового чата
  socket.on('join-room', ({ room, peerId, name }) => {
    if (!room || !peerId) return;
    
    console.log(`👤 ${name || socket.username} присоединяется к комнате ${room} с peerId ${peerId}`);
    
    socket.join(room);
    socket.currentRoom = room;
    socket.peerId = peerId;
    socket.roomName = name || socket.userData?.name || 'Участник';
    
    // Получаем список текущих участников комнаты
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (roomSockets) {
      console.log(`В комнате ${room} сейчас:`, Array.from(roomSockets));
      
      // Отправляем новому пользователю список уже подключенных участников
      roomSockets.forEach(socketId => {
        if (socketId !== socket.id) {
          const otherSocket = io.sockets.sockets.get(socketId);
          if (otherSocket && otherSocket.peerId && otherSocket.roomName) {
            console.log(`Отправляем ${name} информацию о ${otherSocket.roomName}`);
            socket.emit('user-joined', {
              peerId: otherSocket.peerId,
              name: otherSocket.roomName
            });
          }
        }
      });
    }
    
    // Уведомляем других в комнате о новом участнике
    console.log(`Уведомляем комнату ${room} о новом участнике ${name}`);
    socket.to(room).emit('user-joined', {
      peerId,
      name: socket.roomName
    });
  });

  // WebRTC сигналы
  socket.on('webrtc-offer', ({ to, from, offer }) => {
    console.log(`📤 Forwarding WebRTC offer from ${from} to ${to}`);
    const recipientSocketId = activeUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('webrtc-offer', { from, offer });
    }
  });

  socket.on('webrtc-answer', ({ to, from, answer }) => {
    console.log(`📤 Forwarding WebRTC answer from ${from} to ${to}`);
    const recipientSocketId = activeUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('webrtc-answer', { from, answer });
    }
  });

  socket.on('webrtc-ice-candidate', ({ to, from, candidate }) => {
    console.log(`❄️ Forwarding ICE candidate from ${from} to ${to}`);
    const recipientSocketId = activeUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('webrtc-ice-candidate', { from, candidate });
    }
  });

  // Сообщение в чате
  socket.on('chat-message', ({ room, name, text }) => {
    if (!room || !name || !text) return;
    
    io.to(room).emit('chat-message', {
      name,
      text,
      timestamp: new Date().toISOString()
    });
  });

  // Создание группы
  socket.on('create-group', ({ name, members, creator }) => {
    if (!name || !creator) return;
    
    const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const allMembers = [...new Set([...members, creator])];
    
    db.serialize(() => {
      db.run(
        'INSERT INTO groups (id, name, creator) VALUES (?, ?, ?)',
        [groupId, name, creator],
        (err) => {
          if (err) {
            console.error('Ошибка создания группы:', err);
            return socket.emit('group-error', 'Ошибка создания группы');
          }
          
          const stmt = db.prepare('INSERT INTO group_members (group_id, username) VALUES (?, ?)');
          allMembers.forEach(member => {
            stmt.run([groupId, member]);
            
            const memberSocketId = activeUsers.get(member);
            if (memberSocketId) {
              io.to(memberSocketId).emit('group-invite', {
                groupId,
                groupName: name,
                inviter: creator
              });
            }
          });
          stmt.finalize();
          
          socket.emit('group-created', {
            id: groupId,
            name,
            creator,
            members: allMembers
          });
          
          allMembers.forEach(member => {
            const memberSocketId = activeUsers.get(member);
            if (memberSocketId) {
              const memberSocket = io.sockets.sockets.get(memberSocketId);
              if (memberSocket) {
                sendUserGroups(memberSocket, member);
              }
            }
          });
        }
      );
    });
  });

  // Получение списка групп
  socket.on('get-groups', () => {
    if (!socket.username) return;
    sendUserGroups(socket, socket.username);
  });

  // Присоединение к группе
  socket.on('join-group', ({ groupId, userId, name }) => {
    if (!groupId) return;
    
    socket.join(`group_${groupId}`);
    socket.currentGroup = groupId;
    
    // Загружаем историю группы
    db.all(
      'SELECT username as name, message, timestamp FROM group_messages WHERE group_id = ? ORDER BY timestamp ASC LIMIT 100',
      [groupId],
      (err, messages) => {
        if (!err && messages) {
          socket.emit('group-history', messages);
        }
      }
    );
    
    // Уведомляем других участников
    socket.to(`group_${groupId}`).emit('user-joined-group', {
      userId,
      name: name || socket.userData?.name || 'Участник',
      groupId
    });
  });

  // Сообщение в группе
  socket.on('group-message', ({ groupId, name, text }) => {
    if (!groupId || !name || !text) return;
    
    db.run(
      'INSERT INTO group_messages (group_id, username, message) VALUES (?, ?, ?)',
      [groupId, name, text],
      (err) => {
        if (err) console.error('Ошибка сохранения сообщения:', err);
      }
    );
    
    io.to(`group_${groupId}`).emit('group-message', {
      groupId,
      name,
      text,
      timestamp: new Date().toISOString()
    });
  });

  // Запрос дружбы
  socket.on('friend-request', ({ from, to }) => {
    console.log('🤝 Запрос дружбы от', from, 'к', to);
    
    if (from === to) {
      return socket.emit('friend-error', 'Нельзя добавить себя в друзья');
    }
    
    db.get('SELECT username FROM users WHERE username = ?', [to], (err, row) => {
      if (err || !row) {
        return socket.emit('friend-error', 'Пользователь не найден');
      }
      
      db.get(
        'SELECT * FROM friends WHERE user1 = ? AND user2 = ? AND status = ?',
        [from, to, 'pending'],
        (err, existing) => {
          if (existing) {
            return socket.emit('friend-error', 'Запрос уже отправлен');
          }
          
          db.run(
            'INSERT INTO friends (user1, user2, requested_by, status) VALUES (?, ?, ?, ?)',
            [from, to, from, 'pending'],
            (err) => {
              if (err) {
                console.error('Ошибка создания запроса:', err);
                return socket.emit('friend-error', 'Ошибка отправки');
              }
              
              const recipientSocketId = activeUsers.get(to);
              if (recipientSocketId) {
                io.to(recipientSocketId).emit('friend-request', { from, to });
              }
              
              socket.emit('friend-request-sent', { to });
              
              if (recipientSocketId) {
                const recipientSocket = io.sockets.sockets.get(recipientSocketId);
                if (recipientSocket) {
                  sendFriendRequests(recipientSocket, to);
                }
              }
            }
          );
        }
      );
    });
  });

  // Принятие запроса дружбы
  socket.on('accept-friend-request', ({ from, to }) => {
    db.run(
      "UPDATE friends SET status = 'accepted' WHERE user1 = ? AND user2 = ? AND status = 'pending'",
      [from, to],
      (err) => {
        if (err) {
          console.error('Ошибка принятия запроса:', err);
          return;
        }
        
        [from, to].forEach(username => {
          const socketId = activeUsers.get(username);
          if (socketId) {
            const userSocket = io.sockets.sockets.get(socketId);
            if (userSocket) {
              sendFriendsList(userSocket, username);
              sendFriendRequests(userSocket, username);
            }
          }
        });
      }
    );
  });

  // Отклонение запроса дружбы
  socket.on('reject-friend-request', ({ from, to }) => {
    db.run(
      "DELETE FROM friends WHERE user1 = ? AND user2 = ? AND status = 'pending'",
      [from, to],
      (err) => {
        if (err) {
          console.error('Ошибка отклонения запроса:', err);
          return;
        }
        
        const receiverSocketId = activeUsers.get(to);
        if (receiverSocketId) {
          const receiverSocket = io.sockets.sockets.get(receiverSocketId);
          if (receiverSocket) {
            sendFriendRequests(receiverSocket, to);
          }
        }
      }
    );
  });

  // Удаление друга
  socket.on('remove-friend', ({ user1, user2 }) => {
    if (!socket.username) return;
    
    db.run(
      "DELETE FROM friends WHERE ((user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)) AND status = 'accepted'",
      [user1, user2, user2, user1],
      (err) => {
        if (err) {
          console.error('Ошибка удаления друга:', err);
          return;
        }
        
        [user1, user2].forEach(username => {
          const socketId = activeUsers.get(username);
          if (socketId) {
            const userSocket = io.sockets.sockets.get(socketId);
            if (userSocket) {
              sendFriendsList(userSocket, username);
            }
          }
        });
      }
    );
  });

  // Получение списка друзей
  socket.on('get-friends', () => {
    if (!socket.username) return;
    sendFriendsList(socket, socket.username);
  });

  // Получение запросов дружбы
  socket.on('get-friend-requests', () => {
    if (!socket.username) return;
    sendFriendRequests(socket, socket.username);
  });

  // Личные сообщения
  socket.on('private-message', ({ to, from, text }) => {
    if (!to || !from || !text) return;
    
    const recipientSocketId = activeUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('private-message', {
        from,
        text,
        timestamp: new Date().toISOString()
      });
    }
    
    socket.emit('private-message-sent', { to, text });
  });

  // Удаление группы
  socket.on('delete-group', ({ groupId }) => {
    if (!groupId) return;
    
    db.serialize(() => {
      db.run('DELETE FROM group_members WHERE group_id = ?', [groupId]);
      db.run('DELETE FROM group_messages WHERE group_id = ?', [groupId]);
      db.run('DELETE FROM groups WHERE id = ?', [groupId], (err) => {
        if (err) {
          console.error('Ошибка удаления группы:', err);
          return;
        }
        
        io.emit('group-deleted', groupId);
      });
    });
  });

  // Выход из группы
  socket.on('leave-group', ({ groupId, userId }) => {
    if (!groupId) return;
    
    db.run(
      'DELETE FROM group_members WHERE group_id = ? AND username = ?',
      [groupId, socket.username],
      (err) => {
        if (err) {
          console.error('Ошибка выхода из группы:', err);
        }
      }
    );
    
    socket.leave(`group_${groupId}`);
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('❌ Отключение:', socket.id, socket.username);
    
    if (socket.username) {
      activeUsers.delete(socket.username);
    }
    
    // Уведомляем о выходе из комнаты
    if (socket.currentRoom && socket.peerId) {
      socket.to(socket.currentRoom).emit('user-left', {
        peerId: socket.peerId
      });
    }
  });

  // Вспомогательные функции
  function sendFriendsList(socket, username) {
    db.all(
      `SELECT DISTINCT
        CASE 
          WHEN user1 = ? THEN user2 
          WHEN user2 = ? THEN user1 
        END as friend_username
       FROM friends 
       WHERE (user1 = ? OR user2 = ?) 
         AND status = 'accepted'
         AND friend_username IS NOT NULL
       ORDER BY friend_username`,
      [username, username, username, username],
      (err, rows) => {
        if (err) {
          console.error('Ошибка получения друзей:', err);
          return;
        }
        
        const friends = rows.map(row => row.friend_username);
        console.log(`👥 Отправляем список друзей для ${username}:`, friends);
        socket.emit('friends-list', friends);
      }
    );
  }

  function sendFriendRequests(socket, username) {
    db.all(
      'SELECT user1 as from_user FROM friends WHERE user2 = ? AND status = ? ORDER BY created_at DESC',
      [username, 'pending'],
      (err, rows) => {
        if (err) {
          console.error('Ошибка получения запросов:', err);
          return;
        }
        
        socket.emit('friend-requests-list', rows);
      }
    );
  }

  function sendUserGroups(socket, username) {
    db.all(
      `SELECT g.id, g.name, g.creator
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.username = ?
       ORDER BY g.created_at DESC`,
      [username],
      (err, rows) => {
        if (err) {
          console.error('Ошибка получения групп:', err);
          return;
        }
        
        const groupsWithMembers = rows.map(group => {
          return new Promise((resolve) => {
            db.all(
              'SELECT username FROM group_members WHERE group_id = ?',
              [group.id],
              (err, members) => {
                if (err) {
                  resolve({ ...group, members: [] });
                } else {
                  resolve({
                    ...group,
                    members: members.map(m => m.username)
                  });
                }
              }
            );
          });
        });
        
        Promise.all(groupsWithMembers).then(groups => {
          socket.emit('groups-list', groups);
        });
      }
    );
  }
});

// Статические файлы
app.use(express.static('.'));

// Маршрут для проверки
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Neura Voice Server',
    timestamp: new Date().toISOString()
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Доступ по адресу: http://localhost:${PORT}`);
});