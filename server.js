const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const db = new sqlite3.Database('./users.db', (err) => {
  if (err) console.error(err);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT DEFAULT ''
  )`);
  
  // Таблица для групп
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    creator TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Таблица участников групп
  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT,
    username TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, username)
  )`);
  
  // Таблица сообщений групп
  db.run(`CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT,
    username TEXT,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Хранилище для активных соединений
const activeUsers = new Map();
const groups = new Map();

io.on('connection', (socket) => {
  console.log('Клиент подключился:', socket.id);

  // Регистрация
  socket.on('register', ({ name, username, password }) => {
    console.log('Регистрация:', username);
    if (!name || !username || !password) return socket.emit('auth-error', 'Заполните поля');
    
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (row) return socket.emit('auth-error', 'Логин занят');
      
      db.run('INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)', 
        [username, hash, name], (err) => {
        if (err) {
          console.error(err);
          socket.emit('auth-error', 'Ошибка сервера');
        } else {
          socket.emit('auth-success', { name, avatar: '' });
        }
      });
    });
  });

  // Вход
  socket.on('login', ({ username, password }) => {
    console.log('Вход:', username);
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    db.get('SELECT name, avatar FROM users WHERE username = ? AND password_hash = ?', 
      [username, hash], (err, row) => {
      if (err || !row) {
        socket.emit('auth-error', 'Неверный логин или пароль');
      } else {
        // Сохраняем информацию о пользователе
        socket.username = username;
        socket.userData = row;
        activeUsers.set(username, socket.id);
        
        socket.emit('auth-success', { name: row.name, avatar: row.avatar });
        
        // Отправляем список групп пользователя
        sendUserGroups(socket, username);
      }
    });
  });

  // Создание группы
  socket.on('create-group', ({ name, members, creator }) => {
    const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Добавляем создателя в список участников
    const allMembers = [...new Set([...members, creator])];
    
    db.serialize(() => {
      // Создаем группу
      db.run('INSERT INTO groups (id, name, creator) VALUES (?, ?, ?)', 
        [groupId, name, creator], (err) => {
        if (err) {
          console.error(err);
          socket.emit('group-error', 'Ошибка создания группы');
          return;
        }
        
        // Добавляем участников
        const stmt = db.prepare('INSERT INTO group_members (group_id, username) VALUES (?, ?)');
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
            sendUserGroups(io.sockets.sockets.get(memberSocketId), member);
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
        console.error(err);
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

  // Присоединение к группе
  socket.on('join-group', ({ groupId, userId, name }) => {
    socket.join(`group_${groupId}`);
    socket.currentGroup = groupId;
    
    // Загружаем историю сообщений
    db.all(`
      SELECT gm.username as name, gm.message, gm.timestamp
      FROM group_messages gm
      WHERE gm.group_id = ?
      ORDER BY gm.timestamp ASC
      LIMIT 50
    `, [groupId], (err, messages) => {
      if (!err && messages) {
        socket.emit('group-history', messages);
      }
    });
    
    // Уведомляем других участников
    socket.to(`group_${groupId}`).emit('user-joined-group', {
      userId,
      name,
      groupId
    });
  });

  // Сообщение в группе
  socket.on('group-message', ({ groupId, name, text }) => {
    if (!groupId || !name || !text) return;
    
    // Сохраняем в базу
    db.run('INSERT INTO group_messages (group_id, username, message) VALUES (?, ?, ?)',
      [groupId, name, text], (err) => {
        if (err) console.error(err);
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
    db.get('SELECT creator FROM groups WHERE id = ?', [groupId], (err, row) => {
      if (!err && row && row.creator === socket.username) {
        db.serialize(() => {
          db.run('DELETE FROM group_messages WHERE group_id = ?', [groupId]);
          db.run('DELETE FROM group_members WHERE group_id = ?', [groupId]);
          db.run('DELETE FROM groups WHERE id = ?', [groupId], (err) => {
            if (!err) {
              // Уведомляем всех участников
              io.emit('group-deleted', groupId);
            }
          });
        });
      }
    });
  });

  // Выход из группы
  socket.on('leave-group', ({ groupId, userId }) => {
    if (socket.currentGroup === groupId) {
      socket.leave(`group_${groupId}`);
      delete socket.currentGroup;
    }
  });

  // Обновление профиля
  socket.on('update-profile', ({ name, avatar }) => {
    if (!socket.username) return;
    
    db.run('UPDATE users SET name = ?, avatar = ? WHERE username = ?',
      [name, avatar, socket.username], (err) => {
        if (!err) {
          socket.emit('profile-updated', { name, avatar });
        }
      });
  });

  // Присоединение к комнате голосового чата
  socket.on('join-room', ({ room, peerId }) => {
    socket.join(room);
    socket.to(room).emit('user-joined', { peerId, name: socket.userData?.name || 'Пользователь' });
    
    // Сохраняем информацию о комнате
    socket.currentRoom = room;
    socket.peerId = peerId;
  });

  // Сообщение в комнате
  socket.on('chat-message', ({ room, name, text }) => {
    io.to(room).emit('chat-message', { name, text });
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('Клиент отключился:', socket.id);
    
    if (socket.username) {
      activeUsers.delete(socket.username);
    }
    
    // Уведомляем о выходе из комнаты
    if (socket.currentRoom && socket.peerId) {
      socket.to(socket.currentRoom).emit('user-left', { peerId: socket.peerId });
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Сервер запущен на порту ${port}`));
