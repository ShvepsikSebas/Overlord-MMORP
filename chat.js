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
    if (ws) {
        ws.close();
    }
    connectWebSocket();
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
            event.preventDefault(); // Предотвращаем стандартное действие ссылки
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

            // Фокусируем на окне авторизации и проверяем сессию после его закрытия
            const checkAuthInterval = setInterval(() => {
                if (authWindow.closed) {
                    clearInterval(checkAuthInterval);
                    console.log('[chat.js] Discord auth popup closed. Checking session...');
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
