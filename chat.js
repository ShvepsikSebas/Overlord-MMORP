let currentUser = null;
let ws = null;
let isWebSocketReady = false;
let isInitialized = false;
let isConnecting = false;

// Функция для проверки сессии
async function checkSession() {
    try {
        const response = await fetch('/auth/session');
        const data = await response.json();
        console.log('[chat.js] checkSession returned:', data);
        
        // Если сессия невалидна, очищаем localStorage
        if (!data.authenticated) {
            localStorage.removeItem('sessionId');
        }
        
        return data;
    } catch (error) {
        console.error('Ошибка при проверке сессии:', error);
        localStorage.removeItem('sessionId');
        return { authenticated: false };
    }
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
    if (sessionId && !isConnecting && !ws) {
        connectWebSocket(sessionId);
    }
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

    if (ws) {
        ws.close();
        ws = null;
    }
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
        console.log('[chat.js] Closing existing WebSocket connection');
        ws.close();
        ws = null;
    }

    isConnecting = true;
    console.log(`[chat.js] Connecting WebSocket with session ID: ${sessionId}`);
    
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
                updateUIForAuthenticated(data.user);
            }
        } else if (data.type === 'error') {
            addMessage(data.message, 'bot');
            console.error('WebSocket error from server:', data.message);
            if (data.message.includes('авторизация')) {
                localStorage.removeItem('sessionId');
                updateUIForUnauthenticated();
            }
            isConnecting = false;
            if (ws) {
                ws.close();
                ws = null;
            }
        }
    };

    ws.onclose = () => {
        console.log('[chat.js] WebSocket disconnected');
        isWebSocketReady = false;
        isConnecting = false;
        ws = null;
        
        // Проверяем сессию при отключении
        checkSession().then(sessionData => {
            if (!sessionData.authenticated) {
                updateUIForUnauthenticated();
            }
        });
    };

    ws.onerror = error => {
        console.error('[chat.js] WebSocket error:', error);
        isConnecting = false;
        if (ws) {
            ws.close();
            ws = null;
        }
        updateUIForUnauthenticated();
    };
}

// Вспомогательная функция для добавления сообщений в чат
function addMessage(message, sender, author = null) {
    const messagesContainer = document.querySelector('.chat-messages');
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${sender}`;
    
    let textContent = message;
    if (author) {
        textContent = `${author}: ${message}`;
    }
    messageElement.textContent = textContent;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    if (isInitialized) return;
    isInitialized = true;

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
