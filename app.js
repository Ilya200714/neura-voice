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
let audioFilters = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  lucide.createIcons();
});

// Инициализация всех обработчиков событий
function initEventListeners() {
  // Переключение экранов
  document.getElementById('to-register-btn').onclick = () => {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('register-screen').classList.remove('hidden');
  };

  document.getElementById('back-to-login-btn').onclick = () => {
    document.getElementById('register-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  };

  // Регистрация
  document.getElementById('register-btn').onclick = () => {
    const name = document.getElementById('register-name').value.trim();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    
    if (!name || !username || !password) {
      document.getElementById('register-error').textContent = 'Заполните все поля';
      return;
    }
    
    socket.emit('register', { name, username, password });
  };

  // Вход
  document.getElementById('login-btn').onclick = () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    
    if (!username || !password) {
      document.getElementById('auth-error').textContent = 'Заполните поля';
      return;
    }
    
    socket.emit('login', { username, password });
  };

  // Выход
  document.getElementById('logout-btn').onclick = () => {
    if (confirm('Вы уверены, что хотите выйти?')) {
      location.reload();
    }
  };

  // Микрофон
  document.getElementById('mic-btn').onclick = toggleMicrophone;

  // Камера
  document.getElementById('camera-btn').onclick = toggleCamera;

  // Демонстрация экрана
  document.getElementById('screen-share-btn').onclick = shareScreen;

  // Копирование ссылки
  document.getElementById('copy-link-btn').onclick = copyRoomLink;

  // Настройки
  document.getElementById('settings-btn').onclick = openSettings;

  // Добавление друга
  document.getElementById('add-friend-btn').onclick = openAddFriendModal;

  // Создание группы
  document.getElementById('create-group-btn').onclick = createGroup;

  // Чат
  document.getElementById('send-btn').onclick = sendMessage;
  document.getElementById('chat-input').onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage();
  };

  // Эмодзи
  document.getElementById('emoji-btn').onclick = () => {
    document.getElementById('emoji-picker').classList.toggle('hidden');
  };

  // Загрузка медиа
  document.getElementById('media-upload').onchange = handleMediaUpload;

  // Выход из группы
  document.getElementById('leave-group-btn').onclick = leaveGroup;

  // Закрытие модалок
  document.getElementById('close-settings').onclick = () => {
    document.getElementById('settings-modal').classList.add('hidden');
  };
  document.getElementById('cancel-settings').onclick = () => {
    document.getElementById('settings-modal').classList.add('hidden');
  };
  document.getElementById('close-add-friend').onclick = () => {
    document.getElementById('add-friend-modal').classList.add('hidden');
  };
  document.getElementById('cancel-add-friend').onclick = () => {
    document.getElementById('add-friend-modal').classList.add('hidden');
  };

  // Сохранение настроек
  document.getElementById('save-settings').onclick = saveSettings;

  // Отправка запроса дружбы
  document.getElementById('send-friend-request').onclick = sendFriendRequest;
  
  // Обработка изменений в аудио-фильтрах
  document.getElementById('echo-cancellation').addEventListener('change', updateAudioFilters);
  document.getElementById('noise-suppression').addEventListener('change', updateAudioFilters);
  document.getElementById('auto-gain-control').addEventListener('change', updateAudioFilters);
}

// Обработчики Socket.io
socket.on('auth-error', (error) => {
  const isRegisterScreen = !document.getElementById('register-screen').classList.contains('hidden');
  if (isRegisterScreen) {
    document.getElementById('register-error').textContent = error;
  } else {
    document.getElementById('auth-error').textContent = error;
  }
});

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
  
  // Обновляем иконки
  lucide.createIcons();
});

socket.on('chat-message', ({ name, text }) => {
  if (!currentGroup) {
    // Проверяем, не отправляли ли мы это сообщение сами
    const isMyMessage = (name === userName);
    if (!isMyMessage) {
      addMessage(name, text, false);
    }
  }
});

socket.on('group-message', ({ groupId, name, text }) => {
  if (currentGroup && currentGroup.id === groupId) {
    // Проверяем, не отправляли ли мы это сообщение сами
    const isMyMessage = (name === userName);
    if (!isMyMessage) {
      addMessage(name, text, false);
    }
  }
});

socket.on('group-created', (group) => {
  groups.push(group);
  updateGroupsList();
});

socket.on('groups-list', (list) => {
  groups = list;
  updateGroupsList();
});

socket.on('group-deleted', (groupId) => {
  groups = groups.filter(g => g.id !== groupId);
  if (currentGroup && currentGroup.id === groupId) {
    currentGroup = null;
    document.getElementById('chat-title').textContent = 'Чат';
    document.getElementById('leave-group-btn').classList.add('hidden');
    document.getElementById('chat-messages').innerHTML = '';
  }
  updateGroupsList();
});

socket.on('friend-request', ({ from, to }) => {
  if (confirm(`${from} хочет добавить вас в друзья. Принять запрос?`)) {
    socket.emit('accept-friend-request', { from, to });
  }
});

socket.on('friends-list', (list) => {
  friends = list;
  updateFriendsList();
});

// Функции управления
function updateUserProfile() {
  document.getElementById('user-name').textContent = userName;
  document.getElementById('user-initial').textContent = userName.slice(0, 2).toUpperCase();
  
  if (userAvatar) {
    const avatarImg = document.getElementById('user-avatar');
    avatarImg.src = userAvatar;
    avatarImg.classList.remove('hidden');
    document.getElementById('user-initial').classList.add('hidden');
  }
}

async function initVoiceChat() {
  try {
    // Останавливаем старый поток, если есть
    if (myStream) {
      myStream.getTracks().forEach(track => track.stop());
    }
    
    // Получаем новый поток с фильтрами
    myStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        ...audioFilters,
        sampleRate: 48000,
        channelCount: 1,
        latency: 0.01
      },
      video: false 
    });
    
    // Создаем Peer соединение
    peer = new Peer();
    
    peer.on('open', (id) => {
      myPeerId = id;
      console.log('Мой Peer ID:', id);
      
      // Присоединяемся к комнате
      socket.emit('join-room', { 
        room: currentRoom, 
        peerId: id,
        name: userName 
      });
      
      // Добавляем себя в список участников
      addParticipant(id, userName, myStream, true);
    });
    
    // Обработка входящих вызовов
    peer.on('call', (call) => {
      console.log('Входящий вызов от:', call.peer);
      call.answer(myStream);
      
      call.on('stream', (remoteStream) => {
        console.log('Получен поток от:', call.peer);
        addParticipant(call.peer, 'Участник', remoteStream, false);
      });
    });
    
    // Подписываемся на события подключения других пользователей
    socket.on('user-joined', ({ peerId, name }) => {
      console.log('Пользователь присоединился:', peerId, name);
      if (peerId !== myPeerId && peer) {
        // Звоним новому пользователю
        const call = peer.call(peerId, myStream);
        
        call.on('stream', (remoteStream) => {
          console.log('Подключен к пользователю:', peerId);
          addParticipant(peerId, name, remoteStream, false);
        });
        
        call.on('error', (err) => {
          console.error('Ошибка вызова:', err);
        });
      }
    });
    
    socket.on('user-left', ({ peerId }) => {
      console.log('Пользователь вышел:', peerId);
      removeParticipant(peerId);
      
      // Закрываем соединение
      if (peers[peerId]) {
        peers[peerId].close();
        delete peers[peerId];
      }
    });
    
    // Обработка ошибок
    peer.on('error', (err) => {
      console.error('PeerJS ошибка:', err);
    });
    
  } catch (error) {
    console.error('Ошибка инициализации голосового чата:', error);
    alert('Не удалось получить доступ к микрофону. Пожалуйста, разрешите доступ к микрофону в настройках браузера.');
    
    // Все равно показываем интерфейс, но без микрофона
    addParticipant('local', userName, null, true);
  }
}

function toggleMicrophone() {
  if (!myStream) {
    alert('Микрофон не инициализирован');
    return;
  }
  
  const audioTrack = myStream.getAudioTracks()[0];
  if (audioTrack) {
    // Правильно меняем состояние
    micOn = !audioTrack.enabled;
    audioTrack.enabled = micOn;
    
    console.log('Микрофон:', micOn ? 'ВКЛ' : 'ВЫКЛ');
    
    // Обновляем иконку и цвет кнопки
    const micBtn = document.getElementById('mic-btn');
    const icon = micBtn.querySelector('i');
    
    if (micOn) {
      icon.setAttribute('data-lucide', 'mic');
      micBtn.classList.remove('bg-red-600');
      micBtn.classList.add('bg-black/60');
      micBtn.querySelector('span').textContent = 'Микрофон';
    } else {
      icon.setAttribute('data-lucide', 'mic-off');
      micBtn.classList.remove('bg-black/60');
      micBtn.classList.add('bg-red-600');
      micBtn.querySelector('span').textContent = 'Микрофон выкл.';
    }
    
    // Обновляем иконки
    lucide.createIcons();
    
    // Обновляем статус на карточке
    updateMyStatus();
  }
}

function updateMyStatus() {
  const myCard = document.querySelector('[data-self="true"]');
  if (myCard) {
    const statusDiv = myCard.querySelector('.text-sm');
    if (statusDiv) {
      statusDiv.textContent = micOn ? '🎤 Говорит' : '🔇 Микрофон выкл.';
    }
  }
}

async function toggleCamera() {
  try {
    if (!cameraOn) {
      myVideoStream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });
      cameraOn = true;
      
      const cameraBtn = document.getElementById('camera-btn');
      const icon = cameraBtn.querySelector('i');
      icon.setAttribute('data-lucide', 'video-off');
      cameraBtn.classList.add('bg-red-600');
      cameraBtn.querySelector('span').textContent = 'Камера вкл.';
    } else {
      if (myVideoStream) {
        myVideoStream.getTracks().forEach(track => track.stop());
        myVideoStream = null;
      }
      cameraOn = false;
      
      const cameraBtn = document.getElementById('camera-btn');
      const icon = cameraBtn.querySelector('i');
      icon.setAttribute('data-lucide', 'video');
      cameraBtn.classList.remove('bg-red-600');
      cameraBtn.querySelector('span').textContent = 'Камера';
    }
    lucide.createIcons();
  } catch (error) {
    console.error('Ошибка камеры:', error);
    alert('Не удалось получить доступ к камере');
  }
}

async function shareScreen() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
      video: {
        displaySurface: 'monitor',
        cursor: 'always'
      },
      audio: false 
    });
    
    alert('Демонстрация экрана начата!');
    
    // Создаем карточку для демонстрации экрана
    addScreenShareCard(screenStream);
    
    screenStream.getVideoTracks()[0].onended = () => {
      alert('Демонстрация экрана завершена');
      removeScreenShareCard();
    };
  } catch (error) {
    console.error('Ошибка демонстрации экрана:', error);
  }
}

function addScreenShareCard(stream) {
  const card = document.createElement('div');
  card.id = 'screen-share-card';
  card.className = 'glass rounded-3xl p-6 flex flex-col items-center text-center neon col-span-2';
  card.innerHTML = `
    <div class="text-xl font-semibold text-cyan-100 mb-4">📺 Демонстрация экрана</div>
    <video autoplay playsinline class="w-full h-auto rounded-xl max-h-96"></video>
    <div class="text-sm text-cyan-400 mt-2">${userName} показывает экран</div>
  `;
  
  const video = card.querySelector('video');
  video.srcObject = stream;
  
  document.getElementById('participants').appendChild(card);
}

function removeScreenShareCard() {
  const card = document.getElementById('screen-share-card');
  if (card) {
    card.remove();
  }
}

function copyRoomLink() {
  const link = `${window.location.origin}?room=${currentRoom}&user=${encodeURIComponent(userName)}`;
  navigator.clipboard.writeText(link)
    .then(() => {
      alert('✅ Приватная ссылка скопирована в буфер обмена!\n\nОтправьте ее друзьям, чтобы они могли присоединиться.');
    })
    .catch(err => {
      console.error('Ошибка копирования:', err);
      alert('Не удалось скопировать ссылку');
    });
}

function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('profile-name').value = userName;
  document.getElementById('profile-avatar').value = userAvatar;
  
  // Устанавливаем значения аудио-фильтров
  document.getElementById('echo-cancellation').checked = audioFilters.echoCancellation;
  document.getElementById('noise-suppression').checked = audioFilters.noiseSuppression;
  document.getElementById('auto-gain-control').checked = audioFilters.autoGainControl;
  
  // Обновляем предпросмотр аватара
  const avatarPreview = document.getElementById('avatar-preview');
  if (userAvatar) {
    avatarPreview.src = userAvatar;
    avatarPreview.classList.remove('hidden');
  } else {
    avatarPreview.classList.add('hidden');
  }
}

function updateAudioFilters() {
  audioFilters = {
    echoCancellation: document.getElementById('echo-cancellation').checked,
    noiseSuppression: document.getElementById('noise-suppression').checked,
    autoGainControl: document.getElementById('auto-gain-control').checked
  };
  
  console.log('Аудио фильтры обновлены:', audioFilters);
  
  // Перезапускаем микрофон с новыми настройками
  if (myStream) {
    initVoiceChat();
  }
}

function saveSettings() {
  const newName = document.getElementById('profile-name').value.trim();
  const newAvatar = document.getElementById('profile-avatar').value.trim();
  
  if (newName && newName !== userName) {
    userName = newName;
    socket.emit('update-profile', { name: newName, avatar: newAvatar });
    updateUserProfile();
  }
  
  document.getElementById('settings-modal').classList.add('hidden');
  
  // Показываем уведомление
  alert('Настройки сохранены!');
}

function openAddFriendModal() {
  document.getElementById('add-friend-modal').classList.remove('hidden');
  document.getElementById('friend-username').focus();
}

function sendFriendRequest() {
  const friendUsername = document.getElementById('friend-username').value.trim();
  if (!friendUsername) {
    alert('Введите логин друга');
    return;
  }
  
  if (friendUsername === userName) {
    alert('Нельзя добавить себя в друзья');
    return;
  }
  
  socket.emit('friend-request', { 
    from: userName, 
    to: friendUsername 
  });
  
  document.getElementById('add-friend-modal').classList.add('hidden');
  document.getElementById('friend-username').value = '';
  alert(`✅ Запрос дружбы отправлен пользователю ${friendUsername}`);
}

function createGroup() {
  const groupName = prompt('Введите название группы:');
  if (!groupName) return;

  const selectedFriends = prompt('Введите логины друзей через запятую (например: user1, user2, user3):');
  if (!selectedFriends) return;

  const members = selectedFriends.split(',').map(m => m.trim()).filter(m => m);

  socket.emit('create-group', { 
    name: groupName, 
    members, 
    creator: userName 
  });
  
  alert(`Группа "${groupName}" создана!`);
}

function loadGroups() {
  socket.emit('get-groups');
}

function loadFriends() {
  socket.emit('get-friends');
}

function updateGroupsList() {
  const container = document.getElementById('groups-list');
  container.innerHTML = '';
  
  if (groups.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">У вас пока нет групп. Создайте первую!</div>';
    return;
  }
  
  groups.forEach(group => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-4 bg-black/40 rounded-xl cursor-pointer hover:bg-black/60 mb-2';
    div.innerHTML = `
      <div class="flex-1">
        <div class="font-medium text-cyan-100">${group.name}</div>
        <div class="text-sm text-cyan-400">${group.members ? group.members.length : 0} участников</div>
        <div class="text-xs text-gray-400">Создатель: ${group.creator}</div>
      </div>
      <div class="flex gap-2">
        <button class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm" onclick="joinGroup('${group.id}')">
          Войти
        </button>
        ${group.creator === userName ? 
          `<button class="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm" onclick="deleteGroup('${group.id}')">
            Удалить
          </button>` : ''
        }
      </div>
    `;
    container.appendChild(div);
  });
}

function updateFriendsList() {
  const container = document.getElementById('friends-list');
  container.innerHTML = '';
  
  if (friends.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">Добавьте друзей, чтобы общаться вместе!</div>';
    return;
  }
  
  friends.forEach(friend => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-3 bg-black/40 rounded-xl hover:bg-black/60 mb-2';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold">
          ${friend.slice(0,2).toUpperCase()}
        </div>
        <div>
          <div class="font-medium text-cyan-100">${friend}</div>
          <div class="text-xs text-cyan-400">Друг</div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-sm" onclick="inviteFriendToCall('${friend}')">
          Позвать
        </button>
        <button class="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm" onclick="sendMessageToFriend('${friend}')">
          Чат
        </button>
      </div>
    `;
    container.appendChild(div);
  });
}

function addParticipant(id, name, stream, isMe = false) {
  // Проверяем, не добавлен ли уже участник
  if (document.querySelector(`[data-peer-id="${id}"]`)) return;
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.dataset.self = isMe ? 'true' : '';
  card.className = `glass rounded-3xl p-6 flex flex-col items-center text-center neon ${isMe ? 'speaking' : ''}`;
  
  let avatarHTML = `<span class="text-white text-2xl font-bold">${name.slice(0,2).toUpperCase()}</span>`;
  
  card.innerHTML = `
    <div class="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-4xl font-bold text-white mb-4 overflow-hidden">
      ${avatarHTML}
    </div>
    <div class="text-xl font-semibold text-cyan-100">${name}${isMe ? ' (ты)' : ''}</div>
    <div class="text-sm text-cyan-400 mt-1">${isMe ? (micOn ? '🎤 Говорит' : '🔇 Микрофон выкл.') : 'Участник'}</div>
  `;
  
  if (stream) {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = isMe; // Не слушаем себя
    audio.srcObject = stream;
    
    // Добавляем обработчики ошибок аудио
    audio.onerror = (e) => {
      console.error('Ошибка аудио элемента:', e);
    };
    
    card.appendChild(audio);
    
    // Сохраняем соединение
    if (!isMe) {
      // Здесь можно сохранить соединение для управления
    }
  }
  
  document.getElementById('participants').appendChild(card);
  
  // Запускаем анализ аудио для анимации говорящего
  if (isMe && stream) {
    startAudioAnalysis(stream, card);
  }
}

function startAudioAnalysis(stream, card) {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    
    microphone.connect(analyser);
    analyser.fftSize = 256;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function detectSpeaking() {
      analyser.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      // Порог для определения речи
      const isSpeaking = average > 20 && micOn;
      
      if (isSpeaking) {
        card.classList.add('speaking');
      } else {
        card.classList.remove('speaking');
      }
      
      requestAnimationFrame(detectSpeaking);
    }
    
    detectSpeaking();
  } catch (e) {
    console.error('Ошибка анализа аудио:', e);
  }
}

function removeParticipant(peerId) {
  const participantCard = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (participantCard) {
    participantCard.remove();
  }
}

function sendMessage() {
  const chatInput = document.getElementById('chat-input');
  const text = chatInput.value.trim();
  
  if (!text) {
    chatInput.focus();
    return;
  }

  // Добавляем сообщение сразу в интерфейс (только один раз!)
  addMessage(userName, text, true);
  
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
  chatInput.value = '';
  chatInput.focus();
}

function addMessage(name, text, isSelf) {
  const msg = document.createElement('div');
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
  
  const chatMessages = document.getElementById('chat-messages');
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

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
    
    const msg = `<div class="media-message">
      <strong>${userName}:</strong> ${type}<br>
      ${isImage ? `<img src="${event.target.result}" class="media-preview" alt="${type}">` : ''}
      ${isVideo ? `<video src="${event.target.result}" class="media-preview" controls></video>` : ''}
      ${!isImage && !isVideo ? `<a href="${event.target.result}" download="${file.name}">${file.name}</a>` : ''}
    </div>`;
    
    // Добавляем сообщение в интерфейс
    addMessage(userName, msg, true);
    
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

// Глобальные функции
window.joinGroup = function(groupId) {
  currentGroup = groups.find(g => g.id === groupId);
  if (!currentGroup) return;

  socket.emit('join-group', { 
    groupId, 
    userId: myPeerId, 
    name: userName 
  });
  
  document.getElementById('chat-title').textContent = `Группа: ${currentGroup.name}`;
  document.getElementById('leave-group-btn').classList.remove('hidden');
  document.getElementById('chat-messages').innerHTML = '';
  
  addMessage('Система', `Вы присоединились к группе "${currentGroup.name}"`, false);
};

window.deleteGroup = function(groupId) {
  if (confirm('Вы уверены, что хотите удалить группу? Все сообщения будут потеряны.')) {
    socket.emit('delete-group', { groupId });
  }
};

window.inviteFriendToCall = function(friendUsername) {
  const roomLink = `${window.location.origin}?room=${currentRoom}&user=${encodeURIComponent(userName)}`;
  
  if (confirm(`Отправить приглашение ${friendUsername} в голосовой чат?\n\nСсылка: ${roomLink}`)) {
    // Можно добавить отправку через WebSocket
    alert(`Приглашение отправлено ${friendUsername}`);
  }
};

window.sendMessageToFriend = function(friendUsername) {
  const message = prompt(`Отправить личное сообщение ${friendUsername}:`);
  if (message) {
    socket.emit('private-message', {
      to: friendUsername,
      from: userName,
      text: message
    });
    alert(`Сообщение отправлено ${friendUsername}`);
  }
};

function leaveGroup() {
  if (!currentGroup) return;
  
  if (confirm(`Вы уверены, что хотите выйти из группы "${currentGroup.name}"?`)) {
    socket.emit('leave-group', { 
      groupId: currentGroup.id, 
      userId: myPeerId 
    });
    
    currentGroup = null;
    document.getElementById('chat-title').textContent = 'Чат';
    document.getElementById('leave-group-btn').classList.add('hidden');
    document.getElementById('chat-messages').innerHTML = '';
    
    addMessage('Система', 'Вы вышли из группы', false);
  }
}
