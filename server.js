const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Разрешаем запросы со всех доменов
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Настройки Socket.io с CORS
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

// База данных SQLite
const db = new sqlite3.Database(':memory:');

// Инициализация базы данных
function initDatabase() {
  console.log('📀 Инициализация базы данных...');
  
  db.serialize(() => {
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
      if (err) console.error('❌ Ошибка создания таблицы users:', err);
      else console.log('✅ Таблица users создана');
    });

    // Друзья
    db.run(`
      CREATE TABLE IF NOT EXISTS friends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user1 TEXT NOT NULL,
        user2 TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        requested_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user1, user2)
      )
    `, (err) => {
      if (err) console.error('❌ Ошибка создания таблицы friends:', err);
      else console.log('✅ Таблица friends создана');
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
      if (err) console.error('❌ Ошибка создания таблицы groups:', err);
      else console.log('✅ Таблица groups создана');
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
      if (err) console.error('❌ Ошибка создания таблицы group_messages:', err);
      else console.log('✅ Таблица group_messages создана');
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
      if (err) console.error('❌ Ошибка создания таблицы group_members:', err);
      else console.log('✅ Таблица group_members создана');
    });

    // Тестовые пользователи
    const users = [
      { username: 'test', password: '123', name: 'Тестовый пользователь' },
      { username: 'test1', password: '123', name: 'Пользователь 1' },
      { username: 'test2', password: 'password', name: 'Пользователь 2' },
      { username: 'admin', password: 'admin', name: 'Администратор' }
    ];

    users.forEach(user => {
      const hash = crypto.createHash('sha256').update(user.password).digest('hex');
      db.run(
        'INSERT OR IGNORE INTO users (username, password_hash, name) VALUES (?, ?, ?)',
        [user.username, hash, user.name],
        (err) => {
          if (err) console.error(`❌ Ошибка создания пользователя ${user.username}:`, err);
          else console.log(`✅ Тестовый пользователь ${user.username} создан`);
        }
      );
    });
  });
}

initDatabase();

// Хранилище для активных пользователей
const activeUsers = new Map(); // username -> socket.id
const userSockets = new Map(); // socket.id -> {username, peerId, room, ...}

// Вспомогательные функции
function getUsersInRoom(room) {
  const roomSockets = io.sockets.adapter.rooms.get(room);
  if (!roomSockets) return [];
  
  const users = [];
  roomSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.username) {
      users.push({
        username: socket.username,
        name: socket.userData?.name || socket.username,
        peerId: socket.peerId,
        socketId: socketId
      });
    }
  });
  return users;
}

// Socket.io события
io.on('connection', (socket) => {
  console.log('✅ Новое подключение:', socket.id);
  userSockets.set(socket.id, { 
    connectedAt: new Date(),
    socketId: socket.id
  });

  // Регистрация
  socket.on('register', ({ name, username, password }) => {
    console.log('👤 Регистрация:', { name, username });
    
    if (!name || !username || !password) {
      return socket.emit('auth-error', 'Заполните все поля');
    }
    
    if (username.length < 3) {
      return socket.emit('auth-error', 'Логин должен быть не менее 3 символов');
    }
    
    if (password.length < 3) {
      return socket.emit('auth-error', 'Пароль должен быть не менее 3 символов');
    }
    
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('❌ Ошибка базы данных при регистрации:', err);
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
          console.error('❌ Ошибка базы данных при входе:', err);
          return socket.emit('auth-error', 'Ошибка сервера');
        }
        
        if (!row) {
          console.log('❌ Неверные учетные данные для:', username);
          return socket.emit('auth-error', 'Неверный логин или пароль');
        }
        
        socket.username = username;
        socket.userData = row;
        activeUsers.set(username, socket.id);
        userSockets.set(socket.id, { 
          ...userSockets.get(socket.id), 
          username, 
          userData: row 
        });
        
        console.log('✅ Пользователь вошел:', username);
        
        socket.emit('auth-success', {
          name: row.name,
          avatar: row.avatar || ''
        });
        
        sendFriendsList(socket, username);
        sendUserGroups(socket, username);
        sendFriendRequests(socket, username);
      }
    );
  });

  // Обновление профиля
  socket.on('update-profile', ({ name, avatar }) => {
    if (!socket.username) {
      console.log('❌ Попытка обновить профиль без авторизации');
      return;
    }
    
    console.log('⚙️ Обновление профиля для:', socket.username, { name, avatar });
    
    db.run(
      'UPDATE users SET name = ?, avatar = ? WHERE username = ?',
      [name, avatar, socket.username],
      (err) => {
        if (err) {
          console.error('❌ Ошибка обновления профиля:', err);
          return;
        }
        
        socket.userData.name = name;
        socket.userData.avatar = avatar;
        
        socket.emit('profile-updated', { name, avatar });
        console.log('✅ Профиль обновлен для:', socket.username);
      }
    );
  });

  // Присоединение к комнате голосового чата
  socket.on('join-room', ({ room, peerId, name }) => {
    if (!room || !peerId) {
      console.log('❌ Неверные параметры для join-room');
      return;
    }
    
    const displayName = name || socket.userData?.name || socket.username || 'Участник';
    console.log(`👤 ${displayName} присоединяется к комнате ${room} с peerId ${peerId}`);
    
    // Получаем текущих пользователей в комнате
    const currentUsers = getUsersInRoom(room);
    console.log(`👥 В комнате ${room} сейчас: ${currentUsers.length} пользователей`);
    
    // Выходим из предыдущей комнаты если была
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
      socket.to(socket.currentRoom).emit('user-left', {
        peerId: socket.peerId
      });
    }
    
    socket.join(room);
    socket.currentRoom = room;
    socket.peerId = peerId;
    socket.roomName = displayName;
    
    userSockets.set(socket.id, {
      ...userSockets.get(socket.id),
      currentRoom: room,
      peerId: peerId,
      roomName: displayName
    });
    
    // Отправляем новому пользователю список уже подключенных участников
    if (currentUsers.length > 0) {
      console.log(`📤 Отправляем ${displayName} информацию о ${currentUsers.length} участниках`);
      currentUsers.forEach(user => {
        if (user.socketId !== socket.id && user.peerId) {
          // Задержка для стабильности соединения
          setTimeout(() => {
            socket.emit('user-joined', {
              peerId: user.peerId,
              name: user.name
            });
          }, 500);
        }
      });
    }
    
    // Уведомляем других в комнате о новом участнике
    console.log(`📢 Уведомляем комнату ${room} о новом участнике ${displayName}`);
    socket.to(room).emit('user-joined', {
      peerId,
      name: displayName
    });
    
    // Отправляем обновленную информацию о комнате
    const updatedUsers = getUsersInRoom(room);
    console.log(`✅ ${displayName} присоединился. Теперь в комнате: ${updatedUsers.length} участников`);
  });

  // WebRTC сигналы
  socket.on('webrtc-offer', ({ to, from, offer }) => {
    console.log(`📤 Forwarding WebRTC offer from ${from} to ${to}`);
    const recipientSocketId = activeUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('webrtc-offer', { from, offer });
      console.log(`✅ Offer переслан к ${to}`);
    } else {
      console.log(`❌ Получатель ${to} не найден`);
    }
  });

  socket.on('webrtc-answer', ({ to, from, answer }) => {
    console.log(`📤 Forwarding WebRTC answer from ${from} to ${to}`);
    const recipientSocketId = activeUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('webrtc-answer', { from, answer });
      console.log(`✅ Answer переслан к ${to}`);
    } else {
      console.log(`❌ Получатель ${to} не найден`);
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
    
    console.log(`💬 Сообщение в комнате ${room} от ${name}: ${text.substring(0, 50)}...`);
    
    io.to(room).emit('chat-message', {
      name,
      text,
      timestamp: new Date().toISOString()
    });
  });

  // Создание группы
  socket.on('create-group', ({ name, members, creator }) => {
    if (!name || !creator) {
      console.log('❌ Неверные параметры для создания группы');
      return socket.emit('group-error', 'Неверные параметры');
    }
    
    console.log(`👥 Создание группы "${name}" создателем ${creator}`);
    
    const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const allMembers = [...new Set([...members, creator])];
    
    db.serialize(() => {
      db.run(
        'INSERT INTO groups (id, name, creator) VALUES (?, ?, ?)',
        [groupId, name, creator],
        (err) => {
          if (err) {
            console.error('❌ Ошибка создания группы:', err);
            return socket.emit('group-error', 'Ошибка создания группы');
          }
          
          console.log(`✅ Группа создана: ${groupId} "${name}"`);
          
          const stmt = db.prepare('INSERT OR IGNORE INTO group_members (group_id, username) VALUES (?, ?)');
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
          
          // Обновляем список групп для всех участников
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
    if (!socket.username) {
      console.log('❌ Попытка получить группы без авторизации');
      return;
    }
    
    console.log(`📋 Запрос списка групп для: ${socket.username}`);
    sendUserGroups(socket, socket.username);
  });

  // Присоединение к группе
  socket.on('join-group', ({ groupId, userId, name }) => {
    if (!groupId) return;
    
    console.log(`👤 ${name || socket.username} присоединяется к группе ${groupId}`);
    
    socket.join(`group_${groupId}`);
    socket.currentGroup = groupId;
    
    // Проверяем, является ли пользователь участником группы
    db.get(
      'SELECT * FROM group_members WHERE group_id = ? AND username = ?',
      [groupId, socket.username],
      (err, row) => {
        if (!row && socket.username) {
          // Если не участник, добавляем
          db.run(
            'INSERT OR IGNORE INTO group_members (group_id, username) VALUES (?, ?)',
            [groupId, socket.username]
          );
        }
      }
    );
    
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
    
    console.log(`💬 Сообщение в группе ${groupId} от ${name}: ${text.substring(0, 50)}...`);
    
    db.run(
      'INSERT INTO group_messages (group_id, username, message) VALUES (?, ?, ?)',
      [groupId, name, text],
      (err) => {
        if (err) console.error('❌ Ошибка сохранения сообщения:', err);
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
    
    if (!from || !to) {
      return socket.emit('friend-error', 'Неверные параметры');
    }
    
    if (from === to) {
      return socket.emit('friend-error', 'Нельзя добавить себя в друзья');
    }
    
    db.get('SELECT username FROM users WHERE username = ?', [to], (err, row) => {
      if (err || !row) {
        return socket.emit('friend-error', 'Пользователь не найден');
      }
      
      db.get(
        `SELECT * FROM friends WHERE 
         ((user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?))`,
        [from, to, to, from],
        (err, existing) => {
          if (err) {
            console.error('❌ Ошибка проверки дружбы:', err);
            return socket.emit('friend-error', 'Ошибка сервера');
          }
          
          if (existing) {
            if (existing.status === 'accepted') {
              return socket.emit('friend-error', 'Уже друзья');
            } else {
              return socket.emit('friend-error', 'Запрос уже отправлен');
            }
          }
          
          db.run(
            'INSERT INTO friends (user1, user2, requested_by, status) VALUES (?, ?, ?, ?)',
            [from, to, from, 'pending'],
            (err) => {
              if (err) {
                console.error('❌ Ошибка создания запроса:', err);
                return socket.emit('friend-error', 'Ошибка отправки');
              }
              
              console.log(`✅ Запрос дружбы от ${from} к ${to} создан`);
              
              socket.emit('friend-request-sent', { to });
              
              const recipientSocketId = activeUsers.get(to);
              if (recipientSocketId) {
                io.to(recipientSocketId).emit('friend-request', { from });
                
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
    console.log(`✅ Принятие запроса дружбы от ${from} пользователем ${to}`);
    
    db.run(
      "UPDATE friends SET status = 'accepted' WHERE user1 = ? AND user2 = ? AND status = 'pending'",
      [from, to],
      (err) => {
        if (err) {
          console.error('❌ Ошибка принятия запроса:', err);
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
    console.log(`❌ Отклонение запроса дружбы от ${from} пользователем ${to}`);
    
    db.run(
      "DELETE FROM friends WHERE user1 = ? AND user2 = ? AND status = 'pending'",
      [from, to],
      (err) => {
        if (err) {
          console.error('❌ Ошибка отклонения запроса:', err);
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
    
    console.log(`🗑️ Удаление дружбы между ${user1} и ${user2}`);
    
    db.run(
      "DELETE FROM friends WHERE ((user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)) AND status = 'accepted'",
      [user1, user2, user2, user1],
      (err) => {
        if (err) {
          console.error('❌ Ошибка удаления друга:', err);
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
    
    console.log(`📋 Запрос списка друзей для: ${socket.username}`);
    sendFriendsList(socket, socket.username);
  });

  // Получение запросов дружбы
  socket.on('get-friend-requests', () => {
    if (!socket.username) return;
    
    console.log(`📨 Запрос запросов дружбы для: ${socket.username}`);
    sendFriendRequests(socket, socket.username);
  });

  // Личные сообщения
  socket.on('private-message', ({ to, from, text }) => {
    if (!to || !from || !text) return;
    
    console.log(`📩 Личное сообщение от ${from} к ${to}: ${text.substring(0, 50)}...`);
    
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
    
    console.log(`🗑️ Удаление группы: ${groupId}`);
    
    db.serialize(() => {
      db.run('DELETE FROM group_members WHERE group_id = ?', [groupId]);
      db.run('DELETE FROM group_messages WHERE group_id = ?', [groupId]);
      db.run('DELETE FROM groups WHERE id = ?', [groupId], (err) => {
        if (err) {
          console.error('❌ Ошибка удаления группы:', err);
          return;
        }
        
        io.emit('group-deleted', groupId);
        console.log(`✅ Группа ${groupId} удалена`);
      });
    });
  });

  // Выход из группы
  socket.on('leave-group', ({ groupId, userId }) => {
    if (!groupId || !socket.username) return;
    
    console.log(`👋 ${socket.username} выходит из группы ${groupId}`);
    
    db.run(
      'DELETE FROM group_members WHERE group_id = ? AND username = ?',
      [groupId, socket.username],
      (err) => {
        if (err) {
          console.error('❌ Ошибка выхода из группы:', err);
        }
      }
    );
    
    socket.leave(`group_${groupId}`);
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('❌ Отключение:', socket.id, socket.username || 'неизвестный пользователь');
    
    if (socket.username) {
      activeUsers.delete(socket.username);
    }
    
    // Уведомляем о выходе из комнаты
    if (socket.currentRoom && socket.peerId) {
      socket.to(socket.currentRoom).emit('user-left', {
        peerId: socket.peerId,
        name: socket.roomName || socket.username
      });
    }
    
    userSockets.delete(socket.id);
    
    // Статистика
    console.log(`📊 Активные пользователи: ${activeUsers.size}`);
    console.log(`📊 Открытых соединений: ${userSockets.size}`);
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
          console.error('❌ Ошибка получения друзей:', err);
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
          console.error('❌ Ошибка получения запросов:', err);
          return;
        }
        
        console.log(`📨 Отправляем запросы дружбы для ${username}:`, rows);
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
          console.error('❌ Ошибка получения групп:', err);
          return;
        }
        
        console.log(`👥 Получены группы для ${username}:`, rows.length);
        
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
          console.log(`📋 Отправляем группы для ${username}:`, groups);
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
    timestamp: new Date().toISOString(),
    activeUsers: Array.from(activeUsers.keys()),
    connections: userSockets.size
  });
});

// Информация о сервере
app.get('/info', (req, res) => {
  db.all('SELECT COUNT(*) as count FROM users', (err, rows) => {
    res.json({
      server: 'Neura Voice',
      version: '1.0.0',
      uptime: process.uptime(),
      users: rows[0]?.count || 0,
      activeUsers: activeUsers.size,
      connections: userSockets.size
    });
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 HTTP: https://neura-voice-production.up.railway.app`);
  console.log(`📊 Health check: https://neura-voice-production.up.railway.app/health`);
  console.log(`📊 Server info: https://neura-voice-production.up.railway.app/info`);
  console.log(`\n📋 Тестовые пользователи:`);
  console.log(`   👤 Логин: test / Пароль: 123`);
  console.log(`   👤 Логин: test1 / Пароль: 123`);
  console.log(`   👤 Логин: test2 / Пароль: password`);
  console.log(`   👤 Логин: admin / Пароль: admin`);
  console.log(`\n⚡ WebRTC поддерживает P2P соединение через разные сети!`);
});