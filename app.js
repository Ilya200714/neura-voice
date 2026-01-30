const SOCKET_URL = 'https://neura-voice-production.up.railway.app';
console.log('🔗 Подключение к серверу:', SOCKET_URL);

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling']
});

// Глобальные переменные
let myStream = null;
let myPeerId = 'user_' + Date.now();
let currentRoom = 'main';
let userName = '';
let connections = {};
let isMicOn = false;

// ==================== ОСНОВНЫЕ ФУНКЦИИ ====================

// 1. ЗАПРОС МИКРОФОНА
async function requestMicrophone() {
  try {
    console.log('🎤 Запрашиваю микрофон...');
    
    // Сначала запросим разрешение
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false 
    });
    
    myStream = stream;
    isMicOn = true;
    
    console.log('✅ Микрофон получен! Треков:', stream.getTracks().length);
    
    // Покажем себя в списке
    addParticipant(myPeerId, userName, true, true);
    
    // Тестовый звук для проверки
    testMyMicrophone();
    
    return stream;
    
  } catch (error) {
    console.error('❌ Ошибка микрофона:', error);
    alert('⚠️ Разрешите доступ к микрофону в настройках браузера и обновите страницу!');
    addParticipant(myPeerId, userName, false, true);
    return null;
  }
}

// 2. ТЕСТ НАШЕГО МИКРОФОНА
function testMyMicrophone() {
  if (!myStream) return;
  
  // Создаем аудио контекст для визуализации
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(myStream);
  const analyser = audioContext.createAnalyser();
  
  source.connect(analyser);
  
  // Проверяем уровень звука
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  function checkAudio() {
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    
    if (average > 5) {
      console.log('🎤 Микрофон работает! Уровень:', average);
      const status = document.querySelector(`[data-peer-id="${myPeerId}"] .status`);
      if (status) status.textContent = '🎤 ГОВОРИТЕ СЕЙЧАС';
    }
  }
  
  setInterval(checkAudio, 500);
}

// ==================== СОБЫТИЯ СЕРВЕРА ====================

socket.on('connect', () => {
  console.log('✅ Подключен к серверу');
});

// УСПЕШНЫЙ ВХОД
socket.on('auth-success', async (userData) => {
  console.log('✅ Вход успешен');
  userName = userData.name || 'Пользователь';
  
  // Показываем основной интерфейс
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  
  // Обновляем имя
  document.getElementById('user-name').textContent = userName;
  document.getElementById('user-initial').textContent = userName.slice(0, 2).toUpperCase();
  
  // Автоматически запрашиваем микрофон
  const stream = await requestMicrophone();
  
  if (stream) {
    // Присоединяемся к комнате
    socket.emit('join-room', {
      room: currentRoom,
      peerId: myPeerId,
      name: userName
    });
    
    alert(`🎤 Добро пожаловать, ${userName}!\n\nМикрофон включен. Вы в комнате: ${currentRoom}`);
  }
});

// НОВЫЙ УЧАСТНИК
socket.on('user-joined', (data) => {
  console.log('👤 Присоединился:', data);
  
  if (data.peerId !== myPeerId) {
    // Показываем нового участника
    addParticipant(data.peerId, data.name, false, false);
    
    // Если у нас есть микрофон, устанавливаем соединение
    if (myStream) {
      setTimeout(() => setupWebRTC(data.peerId, data.name), 1000);
    }
  }
});

// WEBRTC СОБЫТИЯ
socket.on('webrtc-offer', async (data) => {
  console.log('📥 Получен offer от', data.from);
  await handleOffer(data.from, data.offer);
});

socket.on('webrtc-answer', (data) => {
  console.log('📥 Получен answer от', data.from);
  const pc = connections[data.from];
  if (pc) {
    pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
});

socket.on('webrtc-ice-candidate', (data) => {
  const pc = connections[data.from];
  if (pc && data.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

// СООБЩЕНИЯ ЧАТА
socket.on('chat-message', (data) => {
  addMessage(data.name, data.text, data.name === userName);
});

// ==================== WEBRTC ====================

// УСТАНОВКА СОЕДИНЕНИЯ
async function setupWebRTC(peerId, name) {
  console.log(`🔗 Устанавливаю соединение с ${name}`);
  
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    connections[peerId] = pc;
    
    // Добавляем наш поток
    if (myStream) {
      myStream.getTracks().forEach(track => {
        pc.addTrack(track, myStream);
      });
    }
    
    // Принимаем удаленный поток
    pc.ontrack = (event) => {
      console.log('🎵 Получен аудио поток!');
      
      if (event.streams && event.streams[0]) {
        // Обновляем карточку участника
        updateParticipantWithAudio(peerId, event.streams[0]);
        
        // Создаем скрытый аудио элемент
        const audio = document.createElement('audio');
        audio.id = `audio-${peerId}`;
        audio.autoplay = true;
        audio.controls = false;
        audio.style.display = 'none';
        audio.srcObject = event.streams[0];
        document.body.appendChild(audio);
        
        // Тестируем звук
        testRemoteAudio(audio, name);
      }
    };
    
    // ICE кандидаты
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          to: peerId,
          from: myPeerId,
          candidate: event.candidate
        });
      }
    };
    
    // Создаем offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('webrtc-offer', {
      to: peerId,
      from: myPeerId,
      offer: pc.localDescription
    });
    
  } catch (error) {
    console.error('❌ Ошибка WebRTC:', error);
  }
}

// ОБРАБОТКА OFFER
async function handleOffer(from, offer) {
  console.log('🔄 Обрабатываю offer от', from);
  
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    connections[from] = pc;
    
    // Добавляем наш поток
    if (myStream) {
      myStream.getTracks().forEach(track => {
        pc.addTrack(track, myStream);
      });
    }
    
    // Принимаем удаленный поток
    pc.ontrack = (event) => {
      console.log('🎵 Получен ответный аудио поток!');
      
      if (event.streams && event.streams[0]) {
        updateParticipantWithAudio(from, event.streams[0]);
        
        const audio = document.createElement('audio');
        audio.id = `audio-${from}`;
        audio.autoplay = true;
        audio.controls = false;
        audio.style.display = 'none';
        audio.srcObject = event.streams[0];
        document.body.appendChild(audio);
      }
    };
    
    // ICE кандидаты
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          to: from,
          from: myPeerId,
          candidate: event.candidate
        });
      }
    };
    
    // Устанавливаем offer и создаем answer
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('webrtc-answer', {
      to: from,
      from: myPeerId,
      answer: pc.localDescription
    });
    
  } catch (error) {
    console.error('❌ Ошибка обработки offer:', error);
  }
}

// ==================== ИНТЕРФЕЙС ====================

// ДОБАВЛЕНИЕ УЧАСТНИКА
function addParticipant(id, name, hasAudio, isMe) {
  const existing = document.querySelector(`[data-peer-id="${id}"]`);
  if (existing) return;
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.className = 'glass rounded-3xl p-6 flex flex-col items-center text-center neon';
  if (isMe) card.style.border = '2px solid #00f0ff';
  
  const status = isMe 
    ? (hasAudio ? '🎤 ВКЛЮЧЕН' : '🔇 ВЫКЛЮЧЕН')
    : 'ПОДКЛЮЧЕНИЕ...';
  
  card.innerHTML = `
    <div class="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-2xl font-bold text-white mb-3 avatar" data-peer="${id}">
      ${name.slice(0,2).toUpperCase()}
    </div>
    <div class="text-lg font-semibold text-cyan-100">${name}${isMe ? ' (ВЫ)' : ''}</div>
    <div class="text-sm text-cyan-400 mt-1 status">${status}</div>
    <div class="text-xs text-cyan-500 mt-2">${id.substring(0, 10)}...</div>
    <div class="audio-level mt-3 hidden">
      <div class="audio-level-bar"></div>
    </div>
  `;
  
  document.getElementById('participants').appendChild(card);
  console.log('✅ Добавлен участник:', name);
}

// ОБНОВЛЕНИЕ С АУДИО
function updateParticipantWithAudio(peerId, stream) {
  const card = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (!card) return;
  
  const status = card.querySelector('.status');
  if (status) {
    status.textContent = '🎤 РАЗГОВАРИВАЕТ';
    status.style.color = '#00f0ff';
    status.style.fontWeight = 'bold';
  }
  
  const avatar = card.querySelector('.avatar');
  if (avatar) {
    avatar.classList.add('speaking');
  }
  
  console.log('✅ Аудио подключено для:', peerId);
}

// ТЕСТ УДАЛЕННОГО АУДИО
function testRemoteAudio(audioElement, name) {
  setTimeout(() => {
    if (audioElement.readyState >= 2) { // HAVE_ENOUGH_DATA
      console.log(`✅ Аудио от ${name} загружено и готово`);
      
      // Пробуем воспроизвести
      audioElement.play().then(() => {
        console.log(`✅ Аудио от ${name} воспроизводится`);
        alert(`🎧 Вы слышите ${name}? Проверьте громкость!`);
      }).catch(err => {
        console.log('⚠️ Автовоспроизведение заблокировано, но аудио готово');
      });
    }
  }, 2000);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Приложение загружено');
  
  // Кнопка входа
  document.getElementById('login-btn').addEventListener('click', () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    
    if (!username || !password) {
      alert('Введите логин и пароль');
      return;
    }
    
    socket.emit('login', { username, password });
  });
  
  // Тестовые логины для быстрого входа
  document.getElementById('login-username').value = 'test';
  document.getElementById('login-password').value = '123';
  
  // Кнопка микрофона
  document.getElementById('mic-btn').addEventListener('click', toggleMicrophone);
  
  // Кнопка отправки сообщения
  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  
  // Кнопка приватной ссылки
  document.getElementById('copy-link-btn').addEventListener('click', () => {
    const link = `${window.location.origin}?room=${currentRoom}&user=${userName}`;
    navigator.clipboard.writeText(link).then(() => {
      alert(`✅ Ссылка скопирована!\n\n${link}\n\nОтправьте другу!`);
    });
  });
});

// ПЕРЕКЛЮЧЕНИЕ МИКРОФОНА
function toggleMicrophone() {
  if (!myStream) {
    alert('Сначала войдите в систему и разрешите микрофон');
    return;
  }
  
  const audioTrack = myStream.getAudioTracks()[0];
  if (audioTrack) {
    isMicOn = !audioTrack.enabled;
    audioTrack.enabled = isMicOn;
    
    const icon = document.querySelector('#mic-btn i');
    icon.setAttribute('data-lucide', isMicOn ? 'mic' : 'mic-off');
    lucide.createIcons();
    
    const status = document.querySelector(`[data-peer-id="${myPeerId}"] .status`);
    if (status) {
      status.textContent = isMicOn ? '🎤 ВКЛЮЧЕН' : '🔇 ВЫКЛЮЧЕН';
    }
    
    alert('Микрофон ' + (isMicOn ? 'включен' : 'выключен'));
  }
}

// ОТПРАВКА СООБЩЕНИЯ
function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  
  if (!text || !userName) return;
  
  // Показываем у себя
  addMessage(userName, text, true);
  
  // Отправляем другим
  socket.emit('chat-message', {
    room: currentRoom,
    name: userName,
    text: text
  });
  
  input.value = '';
  input.focus();
}

// ДОБАВЛЕНИЕ СООБЩЕНИЯ
function addMessage(name, text, isSelf) {
  const container = document.getElementById('chat-messages');
  
  const msg = document.createElement('div');
  msg.className = `message ${isSelf ? 'message-self' : 'message-other'}`;
  
  const time = new Date().toLocaleTimeString();
  
  msg.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white text-xs font-bold">
        ${name.slice(0,2).toUpperCase()}
      </div>
      <div>
        <div class="font-semibold text-sm ${isSelf ? 'text-cyan-300' : 'text-cyan-200'}">${name}</div>
        <div class="mt-1">${text}</div>
        <div class="text-xs text-cyan-500 mt-1">${time}</div>
      </div>
    </div>
  `;
  
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

// Глобальная функция для эмодзи
window.addEmojiToInput = function(emoji) {
  const input = document.getElementById('chat-input');
  input.value += emoji;
  input.focus();
};

// Тестовая функция
window.testConnection = function() {
  alert(`
🔍 ТЕСТ СОЕДИНЕНИЯ:

1. Ваш Peer ID: ${myPeerId}
2. Комната: ${currentRoom}
3. Имя: ${userName}
4. Микрофон: ${myStream ? '✅ ВКЛЮЧЕН' : '❌ ВЫКЛЮЧЕН'}
5. Соединения: ${Object.keys(connections).length}

Отправьте эту информацию для диагностики!
  `);
};