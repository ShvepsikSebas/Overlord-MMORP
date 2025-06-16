let ws = null;
let isConnecting = false;
let isWebSocketReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 1; // Уменьшаем до 1 попытки
const RECONNECT_DELAY = 3000;
let reconnectTimeout = null;
let currentUser = null;

// Инициализация WebSocket
let socket = null;
let isAuthenticated = false;

// Функция для добавления сообщения в чат
function addMessage(message, type = 'user', author = '') {
    const chatMessages = document.querySelector('.chat-messages');
    if (!chatMessages) return;

    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${type}`;
    
    const authorElement = document.createElement('div');
    authorElement.className = 'message-author';
    authorElement.textContent = author || (type === 'bot' ? 'Система' : 'Вы');
    
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    contentElement.textContent = message;
    
    messageElement.appendChild(authorElement);
    messageElement.appendChild(contentElement);
    chatMessages.appendChild(messageElement);
    
    // Прокручиваем чат вниз
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Функция для обновления UI при отсутствии авторизации
function updateUIForUnauthenticated() {
    console.log('[chat.js] Updating UI for unauthenticated user.');
    currentUser = null;
    isWebSocketReady = false;
    
    const authMessage = document.querySelector('.auth-message');
    const loginBtn = document.querySelector('.discord-login-btn');
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-message');
    const chatContainer = document.querySelector('.chat-input-container');
    
    if (authMessage) authMessage.style.display = 'block';
    if (loginBtn) loginBtn.style.display = 'flex';
    if (chatInput) {
        chatInput.disabled = true;
        chatInput.value = '';
    }
    if (sendButton) sendButton.disabled = true;
    if (chatContainer) chatContainer.classList.add('disabled');

    // Закрываем WebSocket соединение
    if (ws) {
        ws.close();
        ws = null;
    }
}

// Функция для показа ошибок
function showError(message) {
    const errorContainer = document.querySelector('.error-message');
    if (errorContainer) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
        setTimeout(() => {
            errorContainer.style.display = 'none';
        }, 5000);
    } else {
        console.error(message);
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
    
    // Инициализируем кнопку входа через Discord
    initDiscordLogin();
    
    // Проверяем сессию и обновляем UI
    await updateUIFromSession();
});

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

// Функция для инициализации WebSocket
function initializeWebSocket() {
    if (!isAuthenticated) {
        console.log('Waiting for Discord authentication...');
        return;
    }

    if (socket) {
        socket.close();
    }

    // Создаем WebSocket соединение
    socket = new WebSocket(`ws://${window.location.host}`);

    // Обработчик открытия соединения
    socket.onopen = () => {
        console.log('WebSocket connection established');
        // Отправляем init сообщение с sessionId
        const sessionId = localStorage.getItem('discord_session_id');
        if (sessionId) {
            socket.send(JSON.stringify({
                type: 'init',
                sessionId: sessionId
            }));
        }
    };

    socket.onmessage = event => {
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
                reconnectAttempts = 0;
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

    socket.onclose = () => {
        console.log('[chat.js] WebSocket disconnected');
        isWebSocketReady = false;
        isConnecting = false;
        
        // Пытаемся переподключиться только если у нас есть sessionId и это не было принудительное закрытие
        const sessionId = localStorage.getItem('sessionId');
        if (sessionId && !socket.forceClosed) {
            reconnectWebSocket();
        }
    };

    socket.onerror = error => {
        console.error('[chat.js] WebSocket error:', error);
        isConnecting = false;
        if (socket) {
            socket.forceClosed = true;
            socket.close();
            socket = null;
        }
    };
}

// Функция для переподключения WebSocket
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
            initializeWebSocket();
            reconnectAttempts++;
        }
    }, RECONNECT_DELAY);
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
        reconnectAttempts = 0;
        initializeWebSocket();
    }
}

// Функция для обработки успешной авторизации через Discord
function handleDiscordAuth(sessionId) {
    isAuthenticated = true;
    localStorage.setItem('discord_session_id', sessionId);
    document.getElementById('loginButton').style.display = 'none';
    document.getElementById('userInfo').style.display = 'block';
    document.getElementById('messageInput').disabled = false;
    document.getElementById('sendButton').disabled = false;
    
    // Инициализируем WebSocket после успешной авторизации
    initializeWebSocket();
}

// Обработчик клика по кнопке Discord
document.getElementById('loginButton').addEventListener('click', () => {
    window.location.href = '/auth/discord';
});

// Проверяем авторизацию при загрузке страницы
window.addEventListener('load', () => {
    const sessionId = localStorage.getItem('discord_session_id');
    if (sessionId) {
        handleDiscordAuth(sessionId);
    } else {
        document.getElementById('loginButton').style.display = 'block';
        document.getElementById('userInfo').style.display = 'none';
        document.getElementById('messageInput').disabled = true;
        document.getElementById('sendButton').disabled = true;
    }
});

// Запретить отправку сообщений без авторизации
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-message');
if (chatInput && sendButton) {
    const sendMessage = () => {
        if (!isWebSocketReady || !socket || !currentUser) {
            console.log('[chat.js] Cannot send message: WebSocket not ready or user not authenticated');
            return;
        }
        const message = chatInput.value.trim();
        if (message) {
            socket.send(JSON.stringify({
                type: 'message',
                message: message
            }));
            chatInput.value = '';
        }
    };
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
} 
