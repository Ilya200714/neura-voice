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
});

io.on('connection', (socket) => {
  console.log('Клиент подключился');

  socket.on('register', ({ name, username, password }) => {
    console.log('Регистрация:', username);
    if (!name || !username || !password) return socket.emit('auth-error', 'Заполните поля');
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (row) return socket.emit('auth-error', 'Логин занят');
      db.run('INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)', [username, hash, name], (err) => {
        if (err) socket.emit('auth-error', 'Ошибка сервера');
        else socket.emit('auth-success', { name, avatar: '' });
      });
    });
  });

  socket.on('login', ({ username, password }) => {
    console.log('Вход:', username);
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    db.get('SELECT name, avatar FROM users WHERE username = ? AND password_hash = ?', [username, hash], (err, row) => {
      if (err || !row) socket.emit('auth-error', 'Неверный логин или пароль');
      else socket.emit('auth-success', { name: row.name, avatar: row.avatar });
    });
  });

  socket.on('join-room', ({ room, peerId }) => {
    socket.join(room);
    io.to(room).emit('user-joined', { peerId });
  });

  socket.on('chat-message', ({ room, name, text }) => {
    io.to(room).emit('chat-message', { name, text });
  });

  socket.on('leave-room', ({ room, peerId }) => {
    socket.leave(room);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Сервер на порту ${port}`));
