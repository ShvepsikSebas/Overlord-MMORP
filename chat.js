let ws = null;
let isConnecting = false;
let isWebSocketReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3 seconds
let reconnectTimeout = null;

// Функция для открытия окна авторизации
function openAuthWindow() {
    const width = 600;
    const height = 700;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;
    
    const authWindow = window.open(
        '/auth/discord',
        'Discord Auth',
        `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!authWindow) {
        showError('Пожалуйста, разрешите всплывающие окна для этого сайта');
        return;
    }

    // Обработчик сообщений от окна авторизации
    const messageHandler = function(event) {
        if (event.data.type === 'authSuccess') {
            console.log('Auth success, session ID:', event.data.sessionId);
            // Сохраняем ID сессии
            localStorage.setItem('sessionId', event.data.sessionId);
            // Сохраняем данные пользователя
            localStorage.setItem('userData', JSON.stringify(event.data.user));
            // Обновляем UI
            updateUserInfo(event.data.user);
            // Переподключаем WebSocket
            reconnectWebSocket();
            // Удаляем обработчик после успешной авторизации
            window.removeEventListener('message', messageHandler);
        } else if (event.data.type === 'authError') {
            console.error('Auth error:', event.data.error);
            showError('Ошибка авторизации: ' + event.data.error);
            // Удаляем обработчик при ошибке
            window.removeEventListener('message', messageHandler);
        }
    };

    window.addEventListener('message', messageHandler);
}

// Функция обновления информации о пользователе
function updateUserInfo(user) {
    const userInfo = document.getElementById('userInfo');
    if (userInfo) {
        userInfo.innerHTML = `
            <img src="${user.avatar || '/images/default-avatar.png'}" alt="Avatar" class="avatar">
            <span>${user.username}#${user.discriminator}</span>
        `;
    }
}

// Функция проверки авторизации
async function checkAuth() {
    try {
        const response = await fetch('/auth/session');
        const data = await response.json();
        
        if (data.authenticated) {
            console.log('User is authenticated:', data.user);
            updateUserInfo(data.user);
            return true;
        } else {
            console.log('User is not authenticated');
            return false;
        }
    } catch (error) {
        console.error('Error checking auth:', error);
        return false;
    }
}

// Функция переподключения WebSocket
function reconnectWebSocket() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('[chat.js] Max reconnection attempts reached');
        showError('Не удалось установить соединение. Пожалуйста, обновите страницу.');
        return;
    }

    reconnectTimeout = setTimeout(() => {
        const sessionId = localStorage.getItem('sessionId');
        if (sessionId) {
            console.log(`[chat.js] Attempting to reconnect (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            connectWebSocket(sessionId);
            reconnectAttempts++;
        }
    }, RECONNECT_DELAY);
}

// Инициализация WebSocket connection
function connectWebSocket(sessionId) {
    if (!sessionId) {
        console.error('[chat.js] No sessionId provided for WebSocket connection');
        return;
    }

    if (isConnecting) {
        console.log('[chat.js] WebSocket connection already in progress');
        return;
    }

    if (ws) {
        console.log('[chat.js] Closing existing WebSocket connection');
        ws.close();
        ws = null;
    }

    isConnecting = true;
    console.log(`[chat.js] Connecting WebSocket with session ID: ${sessionId}`);
    
    // Используем протокол wss:// для безопасного соединения
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('[chat.js] WebSocket connected');
        const initMessage = { 
            type: 'init', 
            sessionId: sessionId 
        };
        console.log('[chat.js] Sending init message:', initMessage);
        ws.send(JSON.stringify(initMessage));
    };

    ws.onmessage = event => {
        const data = JSON.parse(event.data);
        console.log('[chat.js] Received WebSocket message:', data);
        
        if (data.type === 'message') {
            const displayAuthor = data.sender === 'support' ? 'Администратор' : data.author;
            addMessage(data.message, data.sender === 'support' ? 'bot' : data.sender, displayAuthor);
        } else if (data.type === 'status') {
            addMessage(data.message, 'bot');
            if (data.authenticated) {
                isWebSocketReady = true;
                isConnecting = false;
                reconnectAttempts = 0; // Сбрасываем счетчик попыток при успешном подключении
                const chatInput = document.getElementById('chat-input');
                const sendButton = document.getElementById('send-message');
                const chatContainer = document.querySelector('.chat-input-container');
                if (chatInput) chatInput.disabled = false;
                if (sendButton) sendButton.disabled = false;
                if (chatContainer) chatContainer.classList.remove('disabled');
            }
        } else if (data.type === 'error') {
            addMessage(data.message, 'bot');
            console.error('WebSocket error from server:', data.message);
            if (data.message.includes('авторизация')) {
                localStorage.removeItem('sessionId');
                localStorage.removeItem('userData');
                updateUIForUnauthenticated();
            }
            isConnecting = false;
        }
    };

    ws.onclose = () => {
        console.log('[chat.js] WebSocket disconnected');
        isWebSocketReady = false;
        isConnecting = false;
        
        // Пытаемся переподключиться только если у нас есть sessionId
        const sessionId = localStorage.getItem('sessionId');
        if (sessionId) {
            reconnectWebSocket();
        }
    };

    ws.onerror = error => {
        console.error('[chat.js] WebSocket error:', error);
        isConnecting = false;
        if (ws) {
            ws.close();
            ws = null;
        }
    };
}

// Функция для обновления UI после авторизации
function updateUIForAuthenticated(user) {
    console.log('[chat.js] Updating UI for authenticated user:', user);
    currentUser = user;
    
    const authMessage = document.querySelector('.auth-message');
    const loginBtn = document.querySelector('.discord-login-btn');
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-message');
    const chatContainer = document.querySelector('.chat-input-container');
    
    if (authMessage) authMessage.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'none';
    if (chatInput) chatInput.disabled = false;
    if (sendButton) sendButton.disabled = false;
    if (chatContainer) chatContainer.classList.remove('disabled');

    // Подключаем WebSocket только если у нас есть sessionId и мы еще не подключаемся
    const sessionId = localStorage.getItem('sessionId');
    if (sessionId && !isConnecting) {
        reconnectAttempts = 0; // Сбрасываем счетчик попыток при новой авторизации
        connectWebSocket(sessionId);
    }
}

// Функция для проверки сессии
async function checkSession() {
    try {
        const response = await fetch('/auth/session');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('[chat.js] Error checking session:', error);
        return { authenticated: false };
    }
}

// Функция для обновления UI после проверки сессии
async function updateUIFromSession() {
    try {
        const session = await checkSession();
        if (session.authenticated) {
            updateUIForAuthenticated(session.user);
        } else {
            updateUIForUnauthenticated();
        }
    } catch (error) {
        console.error('[chat.js] Error updating UI from session:', error);
        updateUIForUnauthenticated();
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[chat.js] DOM Content Loaded. Initializing...');
    const container = document.getElementById("helper-container");
    const img = document.getElementById("helper-img");
    const dialog = document.getElementById("helper-dialog");
    const closeBtn = document.getElementById("close-dialog");
    const nextBtn = document.getElementById("next-phrase");
    const toggleChatBtn = document.getElementById("toggle-chat");
    const textBox = dialog.querySelector(".dialog-text");
    const chatContainer = dialog.querySelector(".chat-container");

    // Элементы чата (изначально отключены)
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-message');
    const chatInputContainer = document.querySelector('.chat-input-container');

    if (chatInput) chatInput.disabled = true;
    if (sendButton) sendButton.disabled = true;
    if (chatInputContainer) chatInputContainer.classList.add('disabled');

    // Инициализация кнопки Discord
    initDiscordLogin();

    // Проверяем сессию и обновляем UI
    await updateUIFromSession();

    // Показываем Швепсика через 2 сек
    if (!localStorage.getItem("hideShvepsik")) {
        setTimeout(() => {
            container.style.display = "flex";
            container.style.opacity = "1";
            container.style.pointerEvents = "auto";
        }, 2000);
    }

    // Клик по Швепсику только открывает диалог, если скрыт
    img.addEventListener("click", () => {
        if (dialog.style.display === "none") {
            dialog.style.display = "block";
        }
    });

    // Крестик закрывает чат или весь диалог в зависимости от состояния
    closeBtn.addEventListener("click", () => {
        const isChatVisible = chatContainer.style.display !== "none";
        
        if (isChatVisible) {
            // Если чат открыт - закрываем только чат
            chatContainer.style.display = "none";
            textBox.style.display = "block";
            nextBtn.style.display = "block";
            toggleChatBtn.style.display = "block";
            toggleChatBtn.textContent = "💬";
            if (dialog.classList.contains('expanded-chat')) {
                dialog.classList.remove('expanded-chat');
            }
        } else {
            // Если чат не открыт - закрываем весь диалог
            dialog.style.display = "none";
        }
    });

    // Кнопка чата
    toggleChatBtn.addEventListener("click", async () => {
        const isChatVisible = chatContainer.style.display !== "none";
        
        if (!isChatVisible) {
            // Показываем чат
            chatContainer.style.display = "block";
            textBox.style.display = "none";
            nextBtn.style.display = "none";
            toggleChatBtn.style.display = "none";
            dialog.classList.add('expanded-chat');
        }
    });

    // Добавляем обработчики для отправки сообщений
    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }

    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
});

// Функция для отображения ошибок
function showError(message) {
    const chatMessages = document.querySelector('.chat-messages');
    if (chatMessages) {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'chat-message bot';
        errorMessage.textContent = message;
        chatMessages.appendChild(errorMessage);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// Инициализация кнопки входа через Discord
function initDiscordLogin() {
    const loginBtn = document.querySelector('.discord-login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', (event) => {
            event.preventDefault();
            console.log('[chat.js] Opening Discord auth popup...');
            
            const width = 600;
            const height = 700;
            const left = (window.innerWidth - width) / 2;
            const top = (window.innerHeight - height) / 2;
            
            const authWindow = window.open(
                '/auth/discord',
                'Discord Auth',
                `width=${width},height=${height},left=${left},top=${top}`
            );

            if (!authWindow) {
                showError('Пожалуйста, разрешите всплывающие окна для этого сайта');
                return;
            }

            // Обработчик сообщений от окна авторизации
            const messageHandler = function(event) {
                if (event.data.type === 'authSuccess') {
                    console.log('[chat.js] Auth success, session ID:', event.data.sessionId);
                    localStorage.setItem('sessionId', event.data.sessionId);
                    localStorage.setItem('userData', JSON.stringify(event.data.user));
                    updateUIForAuthenticated(event.data.user);
                    window.removeEventListener('message', messageHandler);
                } else if (event.data.type === 'authError') {
                    console.error('[chat.js] Auth error:', event.data.error);
                    showError('Ошибка авторизации: ' + event.data.error);
                    window.removeEventListener('message', messageHandler);
                }
            };

            window.addEventListener('message', messageHandler);

            // Проверяем сессию после закрытия окна авторизации
            const checkAuthInterval = setInterval(() => {
                if (authWindow.closed) {
                    clearInterval(checkAuthInterval);
                    console.log('[chat.js] Discord auth popup closed. Checking session...');
                    updateUIFromSession();
                }
            }, 1000);
        });
    }
} 
