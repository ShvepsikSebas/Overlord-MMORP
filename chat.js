let currentUser = null;
let ws = null; // Инициализируем ws как null
let isWebSocketReady = false; // Флаг готовности WebSocket для отправки сообщений

// Функция для проверки сессии
async function checkSession() {
    try {
        const response = await fetch('/auth/session');
        const data = await response.json();
        console.log('[chat.js] checkSession returned:', data);
        return data;
    } catch (error) {
        console.error('Ошибка при проверке сессии:', error);
        return { authenticated: false };
    }
}

// Функция для обновления UI после авторизации
function updateUIForAuthenticated(user) {
    console.log('[chat.js] Updating UI for authenticated user:', user);
    currentUser = user; // Сохраняем данные пользователя
    // Элементы UI будут активированы после получения статуса готовности от сервера через WebSocket
    connectWebSocket(); 
}

// Функция для обновления UI при отсутствии авторизации
function updateUIForUnauthenticated() {
    console.log('[chat.js] Updating UI for unauthenticated user.');
    currentUser = null; // Сбрасываем данные пользователя
    isWebSocketReady = false; // Сбрасываем флаг готовности
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

    // Если WebSocket подключен и пользователь не авторизован, закрываем его.
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
}

// Инициализация кнопки входа через Discord
function initDiscordLogin() {
    const loginBtn = document.querySelector('.discord-login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', (event) => {
            event.preventDefault();
            console.log('[chat.js] Opening Discord auth popup...');
            
            // Открываем окно авторизации
            const authWindow = window.open('/auth/discord', 'DiscordAuth', 'width=500,height=700');
            
            // Слушаем сообщения от окна авторизации
            window.addEventListener('message', function authMessageHandler(event) {
                if (event.data.type === 'authSuccess') {
                    console.log('[chat.js] Received auth success message:', event.data);
                    // Сохраняем sessionId в localStorage
                    localStorage.setItem('sessionId', event.data.sessionId);
                    
                    // Обновляем UI с данными пользователя
                    updateUIForAuthenticated(event.data.user);
                    
                    // Удаляем обработчик сообщений
                    window.removeEventListener('message', authMessageHandler);
                } else if (event.data.type === 'authError') {
                    console.error('[chat.js] Auth error:', event.data.error);
                    alert('Ошибка авторизации: ' + event.data.error);
                    window.removeEventListener('message', authMessageHandler);
                }
            });

            // Проверяем, не закрылось ли окно без авторизации
            const checkAuthInterval = setInterval(() => {
                if (authWindow.closed) {
                    clearInterval(checkAuthInterval);
                    console.log('[chat.js] Discord auth popup closed without auth success');
                    // Проверяем сессию на всякий случай
                    checkSession().then(session => {
                        if (session.authenticated) {
                            updateUIForAuthenticated(session.user);
                        } else {
                            updateUIForUnauthenticated();
                        }
                    });
                }
            }, 1000);
        });
    }
}

// Функция отправки сообщения
function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message && ws && ws.readyState === WebSocket.OPEN) {
        if (!isWebSocketReady) {
            console.warn('WebSocket connection not yet ready. Please wait for authorization and initialization.');
            alert('Подождите, пока чат полностью инициализируется. Если проблема сохраняется, попробуйте перезагрузить страницу.');
            return;
        }

        if (!currentUser) {
            console.warn('Attempted to send message without authentication. Please log in.');
            alert('Для отправки сообщения необходимо авторизоваться через Discord!');
            return;
        }

        const messagesContainer = document.querySelector('.chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message user';
        messageElement.textContent = message;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        input.value = '';

        // Отправляем сообщение на сервер WebSocket с информацией о пользователе
        ws.send(JSON.stringify({
            type: 'chatMessage',
            clientId: localStorage.getItem('clientId'),
            message: message
            // Данные пользователя теперь извлекаются на сервере из сессии WebSocket
        }));

    } else if (message && (!ws || ws.readyState !== WebSocket.OPEN)) {
        console.error('WebSocket is not connected. Cannot send message.');
        alert('Чат недоступен. Попробуйте обновить страницу или повторите попытку позже.');
    }
}

// Инициализация WebSocket connection
function connectWebSocket() {
    // Закрываем существующее соединение, если оно открыто или в процессе подключения
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('[chat.js] WebSocket already connected or connecting. Closing existing connection...');
        ws.close();
        ws = null;
    }

    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        console.error('[chat.js] No session ID found. Cannot establish WebSocket connection.');
        return;
    }

    console.log(`[chat.js] Connecting WebSocket with session ID: ${sessionId}`);
    ws = new WebSocket('wss://overlord-mmorp.onrender.com');

    ws.onopen = () => {
        console.log('[chat.js] WebSocket connected.');
        // Отправляем инициализационное сообщение с sessionId
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
                updateUIForUnauthenticated();
                localStorage.removeItem('sessionId'); // Удаляем недействительный sessionId
            }
        }
    };

    ws.onclose = () => {
        console.log('[chat.js] WebSocket disconnected.');
        if (currentUser) {
            console.log('[chat.js] Attempting to reconnect in 5 seconds...');
            setTimeout(connectWebSocket, 5000);
        } else {
            console.log('[chat.js] Not attempting to reconnect as user is unauthenticated.');
        }
    };

    ws.onerror = error => {
        console.error('[chat.js] WebSocket error:', error);
        if (ws) {
            ws.close();
        }
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

    // Проверяем авторизацию при загрузке страницы
    const session = await checkSession();
    if (session.authenticated) {
        updateUIForAuthenticated(session.user);
    } else {
        updateUIForUnauthenticated();
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
