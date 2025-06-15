// Функция для проверки сессии
async function checkSession() {
    try {
        const response = await fetch('/auth/session');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Ошибка при проверке сессии:', error);
        return { authenticated: false };
    }
}

// Функция для обновления UI после авторизации
function updateUIForAuthenticated(user) {
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
        loginBtn.addEventListener('click', () => {
            window.location.href = '/auth/discord';
        });
    }
}

// Функция отправки сообщения
function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message) {
        const messagesContainer = document.querySelector('.chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message user';
        messageElement.textContent = message;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        input.value = '';
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
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
            // Проверяем авторизацию при открытии чата
            const session = await checkSession();
            if (!session.authenticated) {
                updateUIForUnauthenticated();
            } else {
                updateUIForAuthenticated(session.user);
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