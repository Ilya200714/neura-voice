// Используем текущий домен для Socket.io
const SOCKET_URL = window.location.origin;

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

let peer = null;
let myStream, myVideoStream;
let myPeerId, currentRoom = 'default';
let peers = {};
let micOn = true, cameraOn = false;
let userName = 'Гость';
let userAvatar = '';
let currentGroup = null;
let groups = [];
let friends = [];
let friendRequests = [];

// Проверка подключения
socket.on('connect', () => {
  console.log('✅ Подключено к серверу Socket.io');
});

socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения:', error);
  alert('Не удалось подключиться к серверу. Попробуйте обновить страницу.');
});

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM загружен');
  initEventListeners();
  
  // Инициализируем иконки
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

// Инициализация обработчиков событий
function initEventListeners() {
  console.log('Инициализация обработчиков...');
  
  // Переключение экранов
  const toRegisterBtn = document.getElementById('to-register-btn');
  if (toRegisterBtn) {
    toRegisterBtn.onclick = () => {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('register-screen').classList.remove('hidden');
    };
  }

  const backToLoginBtn = document.getElementById('back-to-login-btn');
  if (backToLoginBtn) {
    backToLoginBtn.onclick = () => {
      document.getElementById('register-screen').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
    };
  }

  // Регистрация - ПРОСТАЯ ВЕРСИЯ
  const registerBtn = document.getElementById('register-btn');
  if (registerBtn) {
    registerBtn.onclick = () => {
      console.log('Нажата кнопка регистрации');
      const name = document.getElementById('register-name')?.value.trim();
      const username = document.getElementById('register-username')?.value.trim();
      const password = document.getElementById('register-password')?.value.trim();
      
      console.log('Данные:', { name, username, password });
      
      if (!name || !username || !password) {
        const errorElem = document.getElementById('register-error');
        if (errorElem) errorElem.textContent = 'Заполните все поля';
        return;
      }
      
      // Очищаем ошибку
      const errorElem = document.getElementById('register-error');
      if (errorElem) errorElem.textContent = '';
      
      // Отправляем запрос
      socket.emit('register', { name, username, password });
    };
  }

  // Вход - ПРОСТАЯ ВЕРСИЯ
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.onclick = () => {
      console.log('Нажата кнопка входа');
      const username = document.getElementById('login-username')?.value.trim();
      const password = document.getElementById('login-password')?.value.trim();
      
      console.log('Данные входа:', { username, password });
      
      if (!username || !password) {
        const errorElem = document.getElementById('auth-error');
        if (errorElem) errorElem.textContent = 'Заполните все поля';
        return;
      }
      
      // Очищаем ошибку
      const errorElem = document.getElementById('auth-error');
      if (errorElem) errorElem.textContent = '';
      
      // Для тестирования можно использовать test/123
      if (username === 'test' && password === '123') {
        console.log('Используется тестовый аккаунт');
      }
      
      // Отправляем запрос
      socket.emit('login', { username, password });
    };
  }

  // Остальные обработчики...
  // ... (добавьте остальные обработчики из предыдущего кода)

  // Обработчики ошибок и успеха
  socket.on('auth-error', (error) => {
    console.log('Ошибка аутентификации:', error);
    
    // Показываем ошибку в нужном месте
    const loginError = document.getElementById('auth-error');
    const registerError = document.getElementById('register-error');
    
    if (loginError && document.getElementById('login-screen').classList.contains('hidden') === false) {
      loginError.textContent = error;
    }
    
    if (registerError && document.getElementById('register-screen').classList.contains('hidden') === false) {
      registerError.textContent = error;
    }
    
    // Также показываем alert для отладки
    alert('Ошибка: ' + error);
  });

  socket.on('auth-success', async (userData) => {
    console.log('Успешная аутентификация:', userData);
    
    userName = userData.name;
    userAvatar = userData.avatar || '';
    
    // Скрываем экраны входа/регистрации
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('register-screen').classList.add('hidden');
    
    // Показываем основной интерфейс
    const mainScreen = document.getElementById('main-screen');
    if (mainScreen) {
      mainScreen.classList.remove('hidden');
    }
    
    // Обновляем профиль
    updateUserProfile();
    
    // Инициализируем голосовой чат
    await initVoiceChat();
    
    // Загружаем группы и друзей
    loadGroups();
    loadFriends();
    loadFriendRequests();
    
    // Обновляем иконки
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    
    alert('✅ Вход выполнен успешно!');
  });

  // Обработчики для других событий...
  // ... (добавьте остальные обработчики из предыдущего кода)
}

// Функция обновления профиля
function updateUserProfile() {
  const userNameDisplay = document.getElementById('user-name');
  const userInitial = document.getElementById('user-initial');
  
  if (userNameDisplay) userNameDisplay.textContent = userName;
  if (userInitial) userInitial.textContent = userName.slice(0, 2).toUpperCase();
  
  // Обновляем аватар если есть
  const avatarContainer = document.getElementById('user-avatar-container');
  if (avatarContainer && userAvatar) {
    const img = avatarContainer.querySelector('img');
    const span = avatarContainer.querySelector('span');
    
    if (img) {
      img.src = userAvatar;
      img.classList.remove('hidden');
    }
    
    if (span) {
      span.classList.add('hidden');
    }
  }
}

// Голосовой чат
async function initVoiceChat() {
  try {
    myStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true,
      video: false 
    });
    
    peer = new Peer();
    
    peer.on('open', (id) => {
      myPeerId = id;
      console.log('Peer ID:', id);
      
      socket.emit('join-room', { 
        room: currentRoom, 
        peerId: id,
        name: userName 
      });
      
      addParticipant(id, userName, myStream, true);
    });
    
    peer.on('call', (call) => {
      call.answer(myStream);
      call.on('stream', (remoteStream) => {
        addParticipant(call.peer, 'Участник', remoteStream, false);
      });
    });
    
    socket.on('user-joined', ({ peerId, name }) => {
      if (peerId !== myPeerId && peer) {
        const call = peer.call(peerId, myStream);
        call.on('stream', (remoteStream) => {
          addParticipant(peerId, name, remoteStream, false);
        });
      }
    });
    
  } catch (error) {
    console.error('Ошибка голосового чата:', error);
    addParticipant('local', userName, null, true);
  }
}

// Добавление участника
function addParticipant(id, name, stream, isMe = false) {
  const participantsDiv = document.getElementById('participants');
  if (!participantsDiv) return;
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.className = `glass rounded-3xl p-6 flex flex-col items-center text-center neon ${isMe ? 'speaking' : ''}`;
  
  card.innerHTML = `
    <div class="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-4xl font-bold text-white mb-4">
      ${name.slice(0,2).toUpperCase()}
    </div>
    <div class="text-xl font-semibold text-cyan-100">${name}${isMe ? ' (ты)' : ''}</div>
    <div class="text-sm text-cyan-400 mt-1">${isMe ? '🎤 Говорит' : 'Участник'}</div>
  `;
  
  if (stream) {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = isMe;
    audio.srcObject = stream;
    card.appendChild(audio);
  }
  
  participantsDiv.appendChild(card);
}

// Загрузка групп
function loadGroups() {
  socket.emit('get-groups');
}

// Загрузка друзей
function loadFriends() {
  socket.emit('get-friends');
}

// Загрузка запросов дружбы
function loadFriendRequests() {
  socket.emit('get-friend-requests');
}

// Обработчики для групп
socket.on('groups-list', (list) => {
  groups = list;
  updateGroupsList();
});

socket.on('friends-list', (list) => {
  friends = list;
  updateFriendsList();
});

socket.on('friend-requests-list', (requests) => {
  friendRequests = requests;
  updateFriendRequestsList();
});

// Остальные функции...
// ... (добавьте остальные функции из предыдущего кода)

// Для тестирования: добавьте эту функцию в консоль браузера
window.testLogin = function() {
  document.getElementById('login-username').value = 'test';
  document.getElementById('login-password').value = '123';
  document.getElementById('login-btn').click();
};

window.testRegister = function() {
  document.getElementById('register-name').value = 'Новый пользователь';
  document.getElementById('register-username').value = 'user' + Date.now();
  document.getElementById('register-password').value = '123';
  document.getElementById('register-btn').click();
};
