const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { 
    origin: '*',
    methods: ['GET', 'POST']
  } 
});

const db = new sqlite3.Database('./neura-voice.db', (err) => {
  if (err) {
    console.error('Ошибка открытия базы данных:', err);
  } else {
    console.log('База данных подключена');
    initDatabase();
  }
});

// Создание таблиц при запуске
function initDatabase() {
  // Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Ошибка создания таблицы users:', err);
  });
  
  // Группы
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    creator TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Ошибка создания таблицы groups:', err);
  });
  
  // Участники групп
  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT,
    username TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, username),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Ошибка создания таблицы group_members:', err);
  });
  
  // Сообщения групп (сохраняем историю)
  db.run(`CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT,
    username TEXT,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Ошибка создания таблицы group_messages:', err);
  });
  
  // Общие сообщения (чат комнаты)
  db.run(`CREATE TABLE IF NOT EXISTS room_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Ошибка создания таблицы room_messages:', err);
  });
  
  // Друзья
  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1 TEXT NOT NULL,
    user2 TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    requested_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user1, user2)
  )`, (err) => {
    if (err) console.error('Ошибка создания таблицы friends:', err);
  });
  
  // Создаем индексы для быстрого поиска
  db.run('CREATE INDEX IF NOT EXISTS idx_friends_user1 ON friends(user1)');
  db.run('CREATE INDEX IF NOT EXISTS idx_friends_user2 ON friends(user2)');
  db.run('CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_room_messages_room ON room_messages(room)');
}

// Хранилище для активных соединений
const activeUsers = new Map();

io.on('connection', (socket) => {
  console.log('✅ Новое подключение:', socket.id);

  // Регистрация пользователя
  socket.on('register', ({ name, username, password }) => {
    console.log('👤 Попытка регистрации:', username);
    
    if (!name || !username || !password) {
      return socket.emit('auth-error', 'Заполните все поля');
    }
    
    // Хэшируем пароль
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    // Проверяем, существует ли пользователь
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('❌ Ошибка БД:', err);
        return socket.emit('auth-error', 'Ошибка сервера');
      }
      
      if (row) {
        return socket.emit('auth-error', 'Пользователь с таким логином уже существует');
      }
      
      // Создаем нового пользователя
      db.run('INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)', 
        [username, hash, name], (err) => {
          if (err) {
            console.error('❌ Ошибка создания пользователя:', err);
            return socket.emit('auth-error', 'Ошибка создания аккаунта');
          }
          
          console.log('✅ Пользователь зарегистрирован:', username);
          socket.emit('auth-success', { 
            name: name, 
            avatar: '' 
          });
        });
    });
  });

  // Вход пользователя
  socket.on('login', ({ username, password }) => {
    console.log('🔑 Попытка входа:', username);
    
    if (!username || !password) {
      return socket.emit('auth-error', 'Заполните все поля');
    }
    
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    db.get('SELECT name, avatar FROM users WHERE username = ? AND password_hash = ?', 
      [username, hash], (err, row) => {
        if (err) {
          console.error('❌ Ошибка БД:', err);
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
        socket.emit('auth-success', { 
          name: row.name, 
          avatar: row.avatar || '' 
        });
        
        // Отправляем список групп пользователя
        sendUserGroups(socket, username);
        
        // Отправляем список друзей
        sendFriendsList(socket, username);
        
        // Отправляем запросы дружбы
        sendFriendRequests(socket, username);
        
        // Загружаем историю общих сообщений комнаты
        loadRoomMessages(socket);
      });
  });

  // Обновление профиля
  socket.on('update-profile', ({ name, avatar }) => {
    if (!socket.username) {
      return socket.emit('auth-error', 'Не авторизован');
    }
    
    db.run('UPDATE users SET name = ?, avatar = ? WHERE username = ?',
      [name, avatar, socket.username], (err) => {
        if (err) {
          console.error('❌ Ошибка обновления профиля:', err);
          return;
        }
        
        // Обновляем данные в памяти
        if (socket.userData) {
          socket.userData.name = name;
          socket.userData.avatar = avatar;
        }
        
        socket.emit('profile-updated', { name, avatar });
      });
  });

  // Присоединение к комнате
  socket.on('join-room', ({ room, peerId, name }) => {
    if (!room || !peerId) return;
    
    socket.join(room);
    socket.currentRoom = room;
    socket.peerId = peerId;
    
    // Уведомляем других участников комнаты
    socket.to(room).emit('user-joined', { 
      peerId, 
      name: name || socket.userData?.name || 'Участник' 
    });
    
    console.log(`👥 Пользователь ${socket.username} присоединился к комнате ${room}`);
  });

  // Отправка сообщения в комнату
  socket.on('chat-message', ({ room, name, text }) => {
    if (!room || !name || !text) return;
    
    // Сохраняем сообщение в базу
    db.run('INSERT INTO room_messages (room, username, message) VALUES (?, ?, ?)',
      [room, name, text], (err) => {
        if (err) console.error('❌ Ошибка сохранения сообщения комнаты:', err);
      });
    
    // Отправляем сообщение всем в комнате
    io.to(room).emit('chat-message', { 
      name, 
      text,
      timestamp: new Date().toISOString()
    });
  });

  // Загрузка истории сообщений комнаты
  function loadRoomMessages(socket) {
    if (!socket.currentRoom) return;
    
    db.all(`
      SELECT username as name, message, timestamp
      FROM room_messages 
      WHERE room = ?
      ORDER BY timestamp DESC
      LIMIT 50
    `, [socket.currentRoom], (err, messages) => {
      if (!err && messages && messages.length > 0) {
        // Отправляем в обратном порядке (новые последние)
        socket.emit('room-history', messages.reverse());
      }
    });
  }

  // Создание группы
  socket.on('create-group', ({ name, members, creator }) => {
    if (!name || !creator) {
      return socket.emit('group-error', 'Недостаточно данных');
    }
    
    const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Добавляем создателя в список участников
    const allMembers = [...new Set([...members, creator])];
    
    db.serialize(() => {
      // Создаем группу
      db.run('INSERT INTO groups (id, name, creator) VALUES (?, ?, ?)', 
        [groupId, name, creator], (err) => {
          if (err) {
            console.error('❌ Ошибка создания группы:', err);
            return socket.emit('group-error', 'Ошибка создания группы');
          }
          
          // Добавляем участников
          const stmt = db.prepare('INSERT OR IGNORE INTO group_members (group_id, username) VALUES (?, ?)');
          allMembers.forEach(member => {
            stmt.run([groupId, member]);
            
            // Уведомляем участников, если они онлайн
            const memberSocketId = activeUsers.get(member);
            if (memberSocketId && memberSocketId !== socket.id) {
              io.to(memberSocketId).emit('group-invite', {
                groupId,
                groupName: name,
                inviter: creator
              });
            }
          });
          stmt.finalize();
          
          // Отправляем подтверждение создателю
          const groupData = {
            id: groupId,
            name,
            creator,
            members: allMembers
          };
          
          socket.emit('group-created', groupData);
          
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
        });
    });
  });

  // Получение списка групп пользователя
  function sendUserGroups(socket, username) {
    db.all(`
      SELECT g.id, g.name, g.creator, 
             (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.username = ?
      ORDER BY g.created_at DESC
    `, [username], (err, rows) => {
      if (err) {
        console.error('❌ Ошибка получения групп:', err);
        return;
      }
      
      // Получаем участников для каждой группы
      const groupsWithMembers = rows.map(group => {
        return new Promise((resolve) => {
          db.all('SELECT username FROM group_members WHERE group_id = ?', 
            [group.id], (err, members) => {
            if (err) {
              resolve({ ...group, members: [] });
            } else {
              resolve({
                ...group,
                members: members.map(m => m.username)
              });
            }
          });
        });
      });
      
      Promise.all(groupsWithMembers).then(groups => {
        socket.emit('groups-list', groups);
      });
    });
  }

  socket.on('get-groups', () => {
    if (!socket.username) return;
    sendUserGroups(socket, socket.username);
  });

  // Присоединение к группе
  socket.on('join-group', ({ groupId, userId, name }) => {
    if (!groupId) return;
    
    socket.join(`group_${groupId}`);
    socket.currentGroup = groupId;
    
    // Загружаем историю сообщений группы
    db.all(`
      SELECT username as name, message, timestamp
      FROM group_messages 
      WHERE group_id = ?
      ORDER BY timestamp ASC
      LIMIT 100
    `, [groupId], (err, messages) => {
      if (!err && messages) {
        socket.emit('group-history', messages);
      }
    });
    
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
    
    // Сохраняем в базу
    db.run('INSERT INTO group_messages (group_id, username, message) VALUES (?, ?, ?)',
      [groupId, name, text], (err) => {
        if (err) console.error('❌ Ошибка сохранения сообщения группы:', err);
      });
    
    // Отправляем всем участникам группы
    io.to(`group_${groupId}`).emit('group-message', {
      groupId,
      name,
      text,
      timestamp: new Date().toISOString()
    });
  });

  // Удаление группы
  socket.on('delete-group', ({ groupId }) => {
    if (!socket.username || !groupId) return;
    
    db.get('SELECT creator FROM groups WHERE id = ?', [groupId], (err, row) => {
      if (err || !row) {
        return socket.emit('group-error', 'Группа не найдена');
      }
      
      if (row.creator !== socket.username) {
        return socket.emit('group-error', 'Только создатель может удалить группу');
      }
      
      db.serialize(() => {
        db.run('DELETE FROM group_messages WHERE group_id = ?', [groupId]);
        db.run('DELETE FROM group_members WHERE group_id = ?', [groupId]);
        db.run('DELETE FROM groups WHERE id = ?', [groupId], (err) => {
          if (err) {
            console.error('❌ Ошибка удаления группы:', err);
            socket.emit('group-error', 'Ошибка удаления группы');
          } else {
            // Уведомляем всех участников
            io.emit('group-deleted', groupId);
          }
        });
      });
    });
  });

  // Выход из группы
  socket.on('leave-group', ({ groupId, userId }) => {
    if (socket.currentGroup === groupId) {
      socket.leave(`group_${groupId}`);
      delete socket.currentGroup;
    }
  });

  // Запрос дружбы
  socket.on('friend-request', ({ from, to }) => {
    console.log('🤝 Запрос дружбы от', from, 'к', to);
    
    if (from === to) {
      return socket.emit('friend-error', 'Нельзя добавить себя в друзья');
    }
    
    // Проверяем, существует ли пользователь
    db.get('SELECT username FROM users WHERE username = ?', [to], (err, row) => {
      if (err || !row) {
        return socket.emit('friend-error', 'Пользователь не найден');
      }
      
      // Проверяем, не отправлен ли уже запрос или уже друзья
      db.get(`
        SELECT * FROM friends 
        WHERE ((user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?))
          AND (status = 'pending' OR status = 'accepted')
      `, [from, to, to, from], (err, existing) => {
        if (err) {
          console.error('❌ Ошибка проверки дружбы:', err);
          return socket.emit('friend-error', 'Ошибка сервера');
        }
        
        if (existing) {
          if (existing.status === 'accepted') {
            return socket.emit('friend-error', 'Вы уже друзья с этим пользователем');
          } else {
            return socket.emit('friend-error', 'Запрос дружбы уже отправлен');
          }
        }
        
        // Создаем запрос дружбы
        db.run('INSERT INTO friends (user1, user2, requested_by, status) VALUES (?, ?, ?, ?)',
          [from, to, from, 'pending'], (err) => {
            if (err) {
              console.error('❌ Ошибка создания запроса дружбы:', err);
              return socket.emit('friend-error', 'Ошибка отправки запроса');
            }
            
            // Отправляем уведомление получателю, если он онлайн
            const recipientSocketId = activeUsers.get(to);
            if (recipientSocketId) {
              io.to(recipientSocketId).emit('friend-request', { from, to });
            }
            
            socket.emit('friend-request-sent', { to });
            
            // Обновляем список запросов для получателя
            if (recipientSocketId) {
              const recipientSocket = io.sockets.sockets.get(recipientSocketId);
              if (recipientSocket) {
                sendFriendRequests(recipientSocket, to);
              }
            }
          });
      });
    });
  });

  // Принятие запроса дружбы
  socket.on('accept-friend-request', ({ from, to }) => {
    db.run(`UPDATE friends SET status = 'accepted' 
            WHERE user1 = ? AND user2 = ? AND status = 'pending'`,
      [from, to], (err) => {
        if (err) {
          console.error('❌ Ошибка принятия запроса дружбы:', err);
          return;
        }
        
        // Обновляем списки друзей обоих пользователей
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
        
        // Уведомляем отправителя
        const senderSocketId = activeUsers.get(from);
        if (senderSocketId) {
          io.to(senderSocketId).emit('friend-request-accepted', { by: to });
        }
      });
  });

  // Отклонение запроса дружбы
  socket.on('reject-friend-request', ({ from, to }) => {
    db.run('DELETE FROM friends WHERE user1 = ? AND user2 = ? AND status = ?',
      [from, to, 'pending'], (err) => {
        if (err) {
          console.error('❌ Ошибка отклонения запроса дружбы:', err);
          return;
        }
        
        // Уведомляем отправителя
        const senderSocketId = activeUsers.get(from);
        if (senderSocketId) {
          io.to(senderSocketId).emit('friend-request-rejected', { by: to });
        }
        
        // Обновляем список запросов для получателя
        const receiverSocketId = activeUsers.get(to);
        if (receiverSocketId) {
          const receiverSocket = io.sockets.sockets.get(receiverSocketId);
          if (receiverSocket) {
            sendFriendRequests(receiverSocket, to);
          }
        }
      });
  });

  // Удаление друга
  socket.on('remove-friend', ({ user1, user2 }) => {
    if (!socket.username || (socket.username !== user1 && socket.username !== user2)) {
      return socket.emit('friend-error', 'Нет прав для удаления');
    }
    
    db.run('DELETE FROM friends WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)',
      [user1, user2, user2, user1], (err) => {
        if (err) {
          console.error('❌ Ошибка удаления друга:', err);
          return;
        }
        
        // Обновляем списки друзей обоих пользователей
        [user1, user2].forEach(username => {
          const socketId = activeUsers.get(username);
          if (socketId) {
            const userSocket = io.sockets.sockets.get(socketId);
            if (userSocket) {
              sendFriendsList(userSocket, username);
            }
          }
        });
      });
  });

  // Получение списка друзей
  function sendFriendsList(socket, username) {
    db.all(`
      SELECT 
        CASE 
          WHEN user1 = ? THEN user2 
          ELSE user1 
        END as friend_username
      FROM friends 
      WHERE (user1 = ? OR user2 = ?) 
        AND status = 'accepted'
      ORDER BY friend_username
    `, [username, username, username], (err, rows) => {
      if (err) {
        console.error('❌ Ошибка получения друзей:', err);
        return;
      }
      
      const friends = rows.map(row => row.friend_username);
      socket.emit('friends-list', friends);
    });
  }

  socket.on('get-friends', () => {
    if (!socket.username) return;
    sendFriendsList(socket, socket.username);
  });

  // Функция отправки запросов дружбы
  function sendFriendRequests(socket, username) {
    db.all(`
      SELECT user1 as from_user, requested_by
      FROM friends 
      WHERE user2 = ? AND status = 'pending'
      ORDER BY created_at DESC
    `, [username], (err, rows) => {
      if (err) {
        console.error('❌ Ошибка получения запросов дружбы:', err);
        return;
      }
      
      socket.emit('friend-requests-list', rows);
    });
  }

  socket.on('get-friend-requests', () => {
    if (!socket.username) return;
    sendFriendRequests(socket, socket.username);
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    console.log('❌ Пользователь отключился:', socket.id, socket.username);
    
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
});

// Статические файлы
app.use(express.static('.'));
app.use(express.json());

// Маршруты
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Neura Voice Server',
    timestamp: new Date().toISOString(),
    activeUsers: activeUsers.size
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🚀 Сервер запущен на порту ${port}`);
  console.log(`🌐 Доступ по адресу: http://localhost:${port}`);
  console.log(`⚡ Готов к работе!`);
  console.log(`💾 База данных: neura-voice.db`);
});
