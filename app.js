const SOCKET_URL = window.location.origin;
const socket = io(SOCKET_URL);

// Глобальные переменные
let myStream;
let myPeerId = 'user_' + Date.now();
let currentRoom = 'default';
let userName = '';
let userAvatar = '';
let currentGroup = null;
let micOn = true;
let cameraOn = false;
let connections = {};

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Приложение загружено');
    
    // Инициализируем обработчики событий
    initAllEventListeners();
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function showElement(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

function hideElement(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function showError(message, type = 'auth') {
    const errorEl = document.getElementById(type + '-error');
    if (errorEl) {
        errorEl.textContent = message;
        setTimeout(() => { errorEl.textContent = ''; }, 5000);
    }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ВСЕХ ОБРАБОТЧИКОВ ====================
function initAllEventListeners() {
    console.log('✅ Инициализация обработчиков событий');
    
    // 1. Переключение между логином и регистрацией
    document.getElementById('to-register-btn')?.addEventListener('click', function() {
        hideElement('login-screen');
        showElement('register-screen');
    });
    
    document.getElementById('back-to-login-btn')?.addEventListener('click', function() {
        hideElement('register-screen');
        showElement('login-screen');
    });
    
    // 2. Кнопка регистрации
    document.getElementById('register-btn')?.addEventListener('click', function() {
        console.log('🔹 Регистрация...');
        const name = document.getElementById('register-name')?.value.trim() || '';
        const username = document.getElementById('register-username')?.value.trim() || '';
        const password = document.getElementById('register-password')?.value.trim() || '';
        
        if (!name || !username || !password) {
            showError('Заполните все поля', 'register');
            return;
        }
        
        if (password.length < 3) {
            showError('Пароль должен быть не менее 3 символов', 'register');
            return;
        }
        
        console.log('Отправка регистрации:', { name, username });
        socket.emit('register', { name, username, password });
    });
    
    // 3. Кнопка входа
    document.getElementById('login-btn')?.addEventListener('click', function() {
        console.log('🔹 Вход...');
        const username = document.getElementById('login-username')?.value.trim() || '';
        const password = document.getElementById('login-password')?.value.trim() || '';
        
        if (!username || !password) {
            showError('Заполните поля', 'auth');
            return;
        }
        
        console.log('Отправка входа:', { username });
        socket.emit('login', { username, password });
    });
    
    // 4. Ввод по Enter
    document.getElementById('login-username')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') document.getElementById('login-btn')?.click();
    });
    
    document.getElementById('login-password')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') document.getElementById('login-btn')?.click();
    });
    
    document.getElementById('register-name')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') document.getElementById('register-btn')?.click();
    });
    
    document.getElementById('register-username')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') document.getElementById('register-btn')?.click();
    });
    
    document.getElementById('register-password')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') document.getElementById('register-btn')?.click();
    });
    
    // 5. Основные кнопки
    document.getElementById('logout-btn')?.addEventListener('click', function() {
        if (confirm('Выйти из аккаунта?')) {
            location.reload();
        }
    });
    
    // 6. Чат
    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') sendMessage();
        });
    }
    
    console.log('✅ Все обработчики инициализированы');
}

// ==================== SOCKET.IO СОБЫТИЯ ====================
socket.on('connect', function() {
    console.log('✅ Подключен к серверу Socket.io');
});

socket.on('connect_error', function(error) {
    console.error('❌ Ошибка подключения:', error);
    showError('Не удалось подключиться к серверу', 'auth');
});

socket.on('auth-error', function(message) {
    console.error('❌ Ошибка аутентификации:', message);
    showError(message, 'auth');
});

socket.on('register-error', function(message) {
    console.error('❌ Ошибка регистрации:', message);
    showError(message, 'register');
});

socket.on('auth-success', async function(userData) {
    console.log('✅ Вход успешен!', userData);
    
    userName = userData.name || 'Пользователь';
    userAvatar = userData.avatar || '';
    
    // Переключаем экраны
    hideElement('login-screen');
    hideElement('register-screen');
    showElement('main-screen');
    
    updateUserProfile();
    
    // Инициализируем голосовой чат
    try {
        await initVoiceChat();
    } catch (error) {
        console.error('Ошибка голосового чата:', error);
    }
    
    alert('✅ Добро пожаловать, ' + userName + '!');
});

socket.on('register-success', function(userData) {
    console.log('✅ Регистрация успешна!', userData);
    alert('✅ Аккаунт создан! Теперь войдите.');
    
    // Переключаем на экран входа
    hideElement('register-screen');
    showElement('login-screen');
    
    // Очищаем поля регистрации
    document.getElementById('register-name').value = '';
    document.getElementById('register-username').value = '';
    document.getElementById('register-password').value = '';
    
    // Автозаполняем логин
    document.getElementById('login-username').value = userData.username || '';
});

// ==================== ГОЛОСОВОЙ ЧАТ ====================
async function initVoiceChat() {
    console.log('🎤 Инициализация голосового чата...');
    
    try {
        myStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true,
            video: false
        });
        
        console.log('✅ Аудио поток получен');
        
        socket.emit('join-room', { 
            room: currentRoom, 
            peerId: myPeerId,
            name: userName 
        });
        
        // Добавляем себя в список участников
        addParticipant(myPeerId, userName, myStream, true);
        
    } catch (error) {
        console.error('❌ Ошибка доступа к микрофону:', error);
        
        // Все равно присоединяемся к комнате (без звука)
        socket.emit('join-room', { 
            room: currentRoom, 
            peerId: myPeerId,
            name: userName 
        });
        
        addParticipant(myPeerId, userName, null, true);
    }
}

// ==================== ОСНОВНЫЕ ФУНКЦИИ ====================
function updateUserProfile() {
    const userNameDisplay = document.getElementById('user-name');
    const userInitial = document.getElementById('user-initial');
    
    if (userNameDisplay) userNameDisplay.textContent = userName;
    if (userInitial) userInitial.textContent = userName.slice(0, 2).toUpperCase();
}

function toggleMicrophone() {
    if (!myStream) {
        alert('Сначала войдите в систему');
        return;
    }
    
    const audioTrack = myStream.getAudioTracks()[0];
    if (audioTrack) {
        micOn = !audioTrack.enabled;
        audioTrack.enabled = micOn;
        
        const micBtn = document.getElementById('mic-btn');
        if (micBtn) {
            const icon = micBtn.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', micOn ? 'mic' : 'mic-off');
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }
        }
        
        console.log('Микрофон ' + (micOn ? 'включен' : 'выключен'));
    }
}

async function toggleCamera() {
    try {
        if (!cameraOn) {
            await navigator.mediaDevices.getUserMedia({ video: true });
            cameraOn = true;
            console.log('Камера включена');
        } else {
            cameraOn = false;
            console.log('Камера выключена');
        }
    } catch (error) {
        console.error('Ошибка камеры:', error);
        alert('Не удалось получить доступ к камере');
    }
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input?.value.trim();
    
    if (!text) return;
    
    // Добавляем сообщение в чат
    const isSelf = true;
    addMessage(userName, text, isSelf);
    
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
    if (input) {
        input.value = '';
        input.focus();
    }
}

function addMessage(name, text, isSelf) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    const msg = document.createElement('div');
    msg.className = `message ${isSelf ? 'message-self' : 'message-other'}`;
    msg.innerHTML = `
        <div class="flex items-start gap-2">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm">
                ${name.slice(0,2).toUpperCase()}
            </div>
            <div>
                <div class="font-semibold text-sm ${isSelf ? 'text-cyan-300' : 'text-cyan-200'}">${name}</div>
                <div class="mt-1">${text}</div>
            </div>
        </div>
    `;
    
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function addParticipant(id, name, stream, isMe = false) {
    const participantsDiv = document.getElementById('participants');
    if (!participantsDiv) return;
    
    // Проверяем, нет ли уже такого участника
    if (document.querySelector(`[data-peer-id="${id}"]`)) return;
    
    const card = document.createElement('div');
    card.dataset.peerId = id;
    card.className = `glass rounded-3xl p-6 flex flex-col items-center text-center neon`;
    
    card.innerHTML = `
        <div class="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-4xl font-bold text-white mb-4">
            ${name.slice(0,2).toUpperCase()}
        </div>
        <div class="text-xl font-semibold text-cyan-100">${name}${isMe ? ' (ты)' : ''}</div>
        <div class="text-sm text-cyan-400 mt-1">${isMe ? (micOn ? '🎤 Говорит' : '🔇 Микрофон выкл.') : 'Участник'}</div>
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