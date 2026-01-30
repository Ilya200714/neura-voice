const SOCKET_URL = 'https://neura-voice-production.up.railway.app';

const socket = io(SOCKET_URL);
let peer = null;

let myStream, myVideoStream;
let myPeerId, currentRoom = 'default';
let peers = {};
let micOn = true, cameraOn = false;
let userName = 'Ты';
let userAvatar = '';
let currentGroup = null;
let groups = [];
let friends = [];
let friendRequests = [];
let audioFilters = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  lucide.createIcons();
  
  // Экспортируем функции для глобального использования
  window.joinGroupHandler = joinGroup;
  window.deleteGroupHandler = deleteGroup;
  window.inviteFriendToCallHandler = inviteFriendToCall;
  window.sendMessageToFriendHandler = sendMessageToFriend;
});

// Инициализация всех обработчиков событий
function initEventListeners() {
  // ... (все обработчики остаются такими же как в предыдущем коде)
  // Просто обновим обработчики для запросов дружбы
}

// Обработчики Socket.io - ОБНОВЛЕННЫЕ
socket.on('auth-success', async (userData) => {
  console.log('Вход успешен:', userData);
  
  userName = userData.name;
  userAvatar = userData.avatar || '';
  
  // Показываем основной интерфейс
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('register-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  
  // Обновляем профиль
  updateUserProfile();
  
  // Инициализируем голосовой чат
  await initVoiceChat();
  
  // Загружаем группы
  loadGroups();
  
  // Загружаем друзей
  loadFriends();
  
  // Загружаем запросы дружбы
  loadFriendRequests();
  
  // Загружаем историю сообщений комнаты
  loadRoomHistory();
  
  // Обновляем иконки
  lucide.createIcons();
});

// История сообщений комнаты
socket.on('room-history', (messages) => {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  
  // Очищаем только если не в группе
  if (!currentGroup) {
    chatMessages.innerHTML = '';
    messages.forEach(msg => {
      addMessage(msg.name, msg.message, msg.name === userName, false);
    });
  }
});

// Загружаем историю комнаты
function loadRoomHistory() {
  socket.emit('get-room-history');
}

// Запросы дружбы - ОБНОВЛЕННЫЕ обработчики
socket.on('friend-request', ({ from, to }) => {
  console.log('Получен запрос дружбы от:', from);
  
  // Показываем уведомление
  showFriendRequestNotification(from);
  
  // Обновляем список запросов
  loadFriendRequests();
});

socket.on('friend-requests-list', (requests) => {
  friendRequests = requests;
  updateFriendRequestsList();
});

socket.on('friend-request-sent', ({ to }) => {
  alert(`✅ Запрос дружбы отправлен пользователю ${to}`);
});

socket.on('friend-request-accepted', ({ by }) => {
  alert(`✅ ${by} принял(а) ваш запрос дружбы!`);
  // Обновляем списки
  loadFriends();
});

socket.on('friend-request-rejected', ({ by }) => {
  alert(`❌ ${by} отклонил(а) ваш запрос дружбы`);
});

socket.on('friend-error', (error) => {
  alert(`Ошибка друзей: ${error}`);
});

socket.on('friends-list', (list) => {
  friends = list;
  updateFriendsList();
});

// Функция для обновления списка запросов дружбы - ИСПРАВЛЕННАЯ
function updateFriendRequestsList() {
  const container = document.getElementById('friend-requests-list');
  const countBadge = document.getElementById('friend-requests-count');
  
  if (!container) return;
  
  container.innerHTML = '';
  
  if (friendRequests.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">Нет новых запросов</div>';
    if (countBadge) {
      countBadge.classList.add('hidden');
    }
    return;
  }
  
  // Показываем счетчик
  if (countBadge) {
    countBadge.textContent = friendRequests.length;
    countBadge.classList.remove('hidden');
  }
  
  friendRequests.forEach(request => {
    const fromUser = request.from_user;
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-3 bg-black/40 rounded-xl hover:bg-black/60 mb-2';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold">
          ${fromUser.slice(0,2).toUpperCase()}
        </div>
        <div>
          <div class="font-medium text-cyan-100">${fromUser}</div>
          <div class="text-xs text-cyan-400">Хочет добавить вас в друзья</div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-sm accept-friend-request-btn" data-from="${fromUser}">
          ✓ Принять
        </button>
        <button class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded-lg text-sm reject-friend-request-btn" data-from="${fromUser}">
          ✕ Отклонить
        </button>
      </div>
    `;
    
    container.appendChild(div);
    
    // Добавляем обработчики для кнопок
    div.querySelector('.accept-friend-request-btn').onclick = () => {
      acceptFriendRequest(fromUser);
    };
    
    div.querySelector('.reject-friend-request-btn').onclick = () => {
      rejectFriendRequest(fromUser);
    };
  });
}

// Функция принятия запроса дружбы - ИСПРАВЛЕННАЯ
function acceptFriendRequest(fromUser) {
  socket.emit('accept-friend-request', { 
    from: fromUser, 
    to: userName 
  });
  
  // Обновляем списки
  setTimeout(() => {
    loadFriends();
    loadFriendRequests();
  }, 500);
}

// Функция отклонения запроса дружбы - ИСПРАВЛЕННАЯ
function rejectFriendRequest(fromUser) {
  if (confirm(`Отклонить запрос дружбы от ${fromUser}?`)) {
    socket.emit('reject-friend-request', { 
      from: fromUser, 
      to: userName 
    });
    
    // Обновляем список запросов
    setTimeout(() => {
      loadFriendRequests();
    }, 500);
  }
}

// Функция отправки сообщения - ИСПРАВЛЕННАЯ для фото
function sendMessage() {
  const chatInput = document.getElementById('chat-input');
  const text = chatInput?.value.trim();
  
  if (!text) {
    if (chatInput) chatInput.focus();
    return;
  }

  // Добавляем сообщение сразу в интерфейс (только один раз!)
  addMessage(userName, text, true, false);
  
  // Отправляем на сервер
  if (currentGroup) {
    socket.emit('group-message', { 
      groupId: currentGroup.id, 
      name: userName, 
      text 
    });
  } else {
    socket.emit('chat-message', { 
      room: currentRoom, 
      name: userName, 
      text 
    });
  }

  // Очищаем поле ввода
  if (chatInput) {
    chatInput.value = '';
    chatInput.focus();
  }
}

// Функция добавления сообщения - ИСПРАВЛЕННАЯ для фото
function addMessage(name, text, isSelf, isMedia = false) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  
  const msg = document.createElement('div');
  
  // Проверяем, содержит ли сообщение медиа (фото/видео)
  const containsMedia = text.includes('<img') || text.includes('<video') || text.includes('media-preview');
  
  if (containsMedia || isMedia) {
    // Для медиа сообщений - без обводки сообщения
    msg.className = `mt-4 ${isSelf ? 'ml-auto' : ''}`;
    msg.style.maxWidth = '75%';
    
    if (isSelf) {
      msg.innerHTML = `
        <div class="flex items-start gap-2 flex-row-reverse">
          <div class="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            ${name.slice(0,2).toUpperCase()}
          </div>
          <div class="text-right">
            <div class="font-semibold text-sm text-cyan-300 mb-1">${name}</div>
            <div class="bg-transparent">${text}</div>
            <div class="text-xs text-cyan-400 mt-1">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
          </div>
        </div>
      `;
    } else {
      msg.innerHTML = `
        <div class="flex items-start gap-2">
          <div class="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            ${name.slice(0,2).toUpperCase()}
          </div>
          <div>
            <div class="font-semibold text-sm text-cyan-200 mb-1">${name}</div>
            <div class="bg-transparent">${text}</div>
            <div class="text-xs text-gray-400 mt-1">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
          </div>
        </div>
      `;
    }
  } else {
    // Для обычных текстовых сообщений - с обводкой
    msg.className = `message ${isSelf ? 'message-self' : 'message-other'}`;
    msg.innerHTML = `
      <div class="flex items-start gap-2">
        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          ${name.slice(0,2).toUpperCase()}
        </div>
        <div>
          <div class="font-semibold text-sm ${isSelf ? 'text-cyan-300' : 'text-cyan-200'}">${name}</div>
          <div class="mt-1">${text}</div>
          <div class="text-xs ${isSelf ? 'text-cyan-400' : 'text-gray-400'} mt-1">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
        </div>
      </div>
    `;
  }
  
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Функция обработки загрузки медиа - ИСПРАВЛЕННАЯ
function handleMediaUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // Проверяем размер файла (максимум 10MB)
  if (file.size > 10 * 1024 * 1024) {
    alert('Файл слишком большой. Максимальный размер: 10MB');
    e.target.value = '';
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    let type = 'Файл';
    if (isImage) type = 'Изображение';
    if (isVideo) type = 'Видео';
    
    let mediaHTML = '';
    if (isImage) {
      mediaHTML = `
        <div class="media-container">
          <img src="${event.target.result}" class="media-content rounded-lg max-w-full" alt="${type}">
          <div class="text-xs text-gray-400 mt-1">${file.name}</div>
        </div>
      `;
    } else if (isVideo) {
      mediaHTML = `
        <div class="media-container">
          <video src="${event.target.result}" class="media-content rounded-lg max-w-full" controls></video>
          <div class="text-xs text-gray-400 mt-1">${file.name}</div>
        </div>
      `;
    } else {
      mediaHTML = `
        <div class="media-container p-3 bg-black/30 rounded-lg">
          <a href="${event.target.result}" download="${file.name}" class="text-cyan-300 hover:text-cyan-100">
            📎 ${file.name}
          </a>
        </div>
      `;
    }
    
    const msg = `<div>${mediaHTML}</div>`;
    
    // Добавляем сообщение в интерфейс (как медиа, без обводки)
    addMessage(userName, msg, true, true);
    
    // Отправляем на сервер
    if (currentGroup) {
      socket.emit('group-message', { 
        groupId: currentGroup.id, 
        name: userName, 
        text: msg 
      });
    } else {
      socket.emit('chat-message', { 
        room: currentRoom, 
        name: userName, 
        text: msg 
      });
    }
  };
  reader.readAsDataURL(file);
  
  e.target.value = '';
}

// Остальные функции остаются такими же, как в предыдущем коде
// ...

// Добавляем стили для медиа в CSS
const style = document.createElement('style');
style.textContent = `
  .media-container {
    max-width: 300px;
    margin-top: 4px;
  }
  
  .media-content {
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.3);
  }
  
  .media-preview {
    max-width: 100%;
    border-radius: 8px;
    margin-top: 4px;
    background: transparent;
    border: none;
  }
`;
document.head.appendChild(style);
