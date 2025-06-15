let currentUser = null;
let ws = null;
let isWebSocketReady = false;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 3000;
let reconnectTimeout = null;
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL = 30000; // 30 секунд

// Функция для проверки сессии
async function checkSession() {
    try {
        const response = await fetch('/auth/session');
        const data = await response.json();
        console.log('[chat.js] checkSession returned:', data);
        
        if (!data.authenticated) {
            localStorage.removeItem('sessionId');
            closeWebSocket();
            updateUIForUnauthenticated();
        }
        
        return data;
    } catch (error) {
        console.error('Ошибка при проверке сессии:', error);
        localStorage.removeItem('sessionId');
        closeWebSocket();
        updateUIForUnauthenticated();
        return { authenticated: false };
    }
}

// Функция для закрытия WebSocket соединения
function closeWebSocket() {
    if (ws) {
        ws.close();
        ws = null;
    }
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    isWebSocketReady = false;
    isConnecting = false;
    reconnectAttempts = 0;
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

    // Подключаем WebSocket только если у нас есть sessionId и нет активного соединения
    const sessionId = localStorage.getItem('sessionId');
    if (sessionId && !ws && !isConnecting) {
        connectWebSocket(sessionId);
    }
}

// Функция для обновления UI при отсутствии авторизации
function updateUIForUnauthenticated() {
    console.log('[chat.js] Updating UI for unauthenticated user.');
    currentUser = null;
    closeWebSocket();
    
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
}

// Инициализация кнопки входа через Discord
function initDiscordLogin() {
    const loginBtn = document.querySelector('.discord-login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', (event) => {
            event.preventDefault();
            console.log('[chat.js] Opening Discord auth popup...');
            
            const authWindow = window.open('/auth/discord', 'DiscordAuth', 'width=500,height=700');
            
            window.addEventListener('message', function authMessageHandler(event) {
                if (event.data.type === 'authSuccess') {
                    console.log('[chat.js] Received auth success message:', event.data);
                    localStorage.setItem('sessionId', event.data.sessionId);
                    updateUIForAuthenticated(event.data.user);
                    window.removeEventListener('message', authMessageHandler);
                } else if (event.data.type === 'authError') {
                    console.error('[chat.js] Auth error:', event.data.error);
                    alert('Ошибка авторизации: ' + event.data.error);
                    window.removeEventListener('message', authMessageHandler);
                }
            });

            const checkAuthInterval = setInterval(() => {
                if (authWindow.closed) {
                    clearInterval(checkAuthInterval);
                    console.log('[chat.js] Discord auth popup closed');
                }
            }, 1000);
        });
    }
}

// Функция для добавления сообщения в чат
function addMessage(message, type, author = '') {
    const chatMessages = document.querySelector('.chat-messages');
    if (!chatMessages) return;

    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    if (author) {
        const authorElement = document.createElement('div');
        authorElement.className = 'message-author';
        authorElement.textContent = author;
        content.appendChild(authorElement);
    }
    
    const textElement = document.createElement('div');
    textElement.className = 'message-text';
    textElement.textContent = message;
    content.appendChild(textElement);
    
    messageElement.appendChild(content);
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Инициализация WebSocket connection
function connectWebSocket(sessionId) {
    if (!sessionId) {
        console.error('[chat.js] No sessionId provided for WebSocket connection');
        updateUIForUnauthenticated();
        return;
    }

    if (isConnecting) {
        console.log('[chat.js] WebSocket connection already in progress');
        return;
    }

    if (ws) {
        console.log('[chat.js] WebSocket already connected');
        return;
    }

    isConnecting = true;
    console.log(`[chat.js] Connecting WebSocket with session ID: ${sessionId}`);
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('[chat.js] WebSocket connected');
        // Отправляем только sessionId
        const initMessage = { 
            type: 'init', 
            sessionId: sessionId 
        };
        console.log('[chat.js] Sending init message:', initMessage);
        ws.send(JSON.stringify(initMessage));

        // Запускаем heartbeat для поддержания соединения
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'heartbeat' }));
            }
        }, HEARTBEAT_INTERVAL);
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
                reconnectAttempts = 0;
                updateUIForAuthenticated(data.user);
            }
        } else if (data.type === 'error') {
            addMessage(data.message, 'bot');
            console.error('WebSocket error from server:', data.message);
            if (data.message.includes('авторизация')) {
                localStorage.removeItem('sessionId');
                updateUIForUnauthenticated();
            }
            closeWebSocket();
        }
    };

    ws.onclose = () => {
        console.log('[chat.js] WebSocket disconnected');
        isWebSocketReady = false;
        isConnecting = false;
        ws = null;
        
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        
        // Проверяем сессию при отключении
        checkSession().then(sessionData => {
            if (!sessionData.authenticated) {
                updateUIForUnauthenticated();
            } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                // Пытаемся переподключиться только если есть валидная сессия
                reconnectAttempts++;
                console.log(`[chat.js] Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                reconnectTimeout = setTimeout(() => {
                    const sessionId = localStorage.getItem('sessionId');
                    if (sessionId) {
                        connectWebSocket(sessionId);
                    }
                }, RECONNECT_DELAY);
            } else {
                console.log('[chat.js] Max reconnection attempts reached');
                updateUIForUnauthenticated();
            }
        });
    };

    ws.onerror = error => {
        console.error('[chat.js] WebSocket error:', error);
        closeWebSocket();
        updateUIForUnauthenticated();
    };
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    // Очищаем старые сообщения при загрузке
    const chatMessages = document.querySelector('.chat-messages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }

    // Проверяем сессию при загрузке
    const sessionData = await checkSession();
    console.log('[chat.js] Initial session check:', sessionData);

    if (sessionData.authenticated) {
        const sessionId = localStorage.getItem('sessionId');
        if (sessionId) {
            updateUIForAuthenticated(sessionData.user);
        } else {
            updateUIForUnauthenticated();
        }
    } else {
        updateUIForUnauthenticated();
    }

    // Инициализируем кнопку входа
    initDiscordLogin();

    // Добавляем обработчик отправки сообщений
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-message');

    if (chatInput && sendButton) {
        const sendMessage = () => {
            if (!isWebSocketReady || !ws || !currentUser) {
                console.log('[chat.js] Cannot send message: WebSocket not ready or user not authenticated');
                return;
            }

            const message = chatInput.value.trim();
            if (message) {
                ws.send(JSON.stringify({
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
            
            // WebSocket уже подключен через updateUIForAuthenticated после авторизации
            // Нет необходимости вызывать connectWebSocket() здесь повторно.
        }
    });
}); 
