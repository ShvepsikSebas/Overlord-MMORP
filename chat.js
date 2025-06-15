let currentUser = null;
let ws;

// Вспомогательная функция для получения значения cookie
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Функция для проверки сессии
async function checkSession() {
    try {
        const response = await fetch('/auth/session');
        const data = await response.json();
        console.log('checkSession returned:', data);
        return data;
    } catch (error) {
        console.error('Ошибка при проверке сессии:', error);
        return { authenticated: false };
    }
}

// Функция для обновления UI после авторизации
function updateUIForAuthenticated(user) {
    console.log('Updating UI for authenticated user:', user);
    currentUser = user; // Сохраняем данные пользователя
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
}

// Функция для обновления UI при отсутствии авторизации
function updateUIForUnauthenticated() {
    console.log('Updating UI for unauthenticated user.');
    currentUser = null; // Сбрасываем данные пользователя
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
            event.preventDefault(); // Предотвращаем стандартное действие ссылки
            console.log('Opening Discord auth popup...');
            const authWindow = window.open('/auth/discord', 'DiscordAuth', 'width=500,height=700');
            
            // Фокусируем на окне авторизации и проверяем сессию после его закрытия
            const checkAuthInterval = setInterval(() => {
                if (authWindow.closed) {
                    clearInterval(checkAuthInterval);
                    console.log('Discord auth popup closed. Checking session...');
                    // После закрытия окна авторизации, проверяем сессию
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
            message: message,
            user: {
                id: currentUser.id,
                username: currentUser.username,
                discriminator: currentUser.discriminator
            }
        }));

    } else if (message && (!ws || ws.readyState !== WebSocket.OPEN)) {
        console.error('WebSocket is not connected. Cannot send message.');
        alert('Чат недоступен. Попробуйте обновить страницу или повторите попытку позже.');
    }
}

// Инициализация WebSocket connection
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('WebSocket already connected or connecting.');
        return;
    }

    const clientId = localStorage.getItem('clientId');
    const sessionId = getCookie('sessionId'); // Получаем sessionId из куки

    if (!clientId) {
        console.error('Client ID not found. Cannot establish WebSocket connection.');
        return;
    }

    console.log(`Connecting WebSocket for client ${clientId} with sessionId: ${sessionId}`);
    ws = new WebSocket('wss://overlord-mmorp.onrender.com');

    ws.onopen = () => {
        console.log('WebSocket connected.');
        // Send initial message with client ID and session ID
        ws.send(JSON.stringify({ type: 'init', clientId: clientId, session: sessionId }));
    };

    ws.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.type === 'message') {
            const displayAuthor = data.sender === 'support' ? 'Администратор' : data.author;
            addMessage(data.message, data.sender === 'support' ? 'bot' : data.sender, displayAuthor);
        } else if (data.type === 'status') {
            addMessage(data.message, 'bot');
        } else if (data.type === 'error') {
            addMessage(data.message, 'bot');
            console.error('WebSocket error from server:', data.message);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected. Attempting to reconnect in 5 seconds...');
        setTimeout(connectWebSocket, 5000); // Reconnect on close
    };

    ws.onerror = error => {
        console.error('WebSocket error:', error);
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
    console.log('DOM Content Loaded. Initializing...');
    const container = document.getElementById("helper-container");
    const img = document.getElementById("helper-img");
    const dialog = document.getElementById("helper-dialog");
    const closeBtn = document.getElementById("close-dialog");
    const nextBtn = document.getElementById("next-phrase");
    const toggleChatBtn = document.getElementById("toggle-chat");
    const textBox = dialog.querySelector(".dialog-text");
    const chatContainer = dialog.querySelector(".chat-container");

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
            // Подключаем WebSocket при первом открытии чата
            if (!ws) {
                connectWebSocket();
            }
            // Показываем чат
            chatContainer.style.display = "block";
            textBox.style.display = "none";
            nextBtn.style.display = "none";
            toggleChatBtn.style.display = "none";
            dialog.classList.add('expanded-chat');
        }
    });

    // Добавляем обработчики для отправки сообщений
    const sendButton = document.getElementById('send-message');
    const chatInput = document.getElementById('chat-input');

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
