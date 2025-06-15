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

    // Обработчик сообщений от окна авторизации
    window.addEventListener('message', function(event) {
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
        } else if (event.data.type === 'authError') {
            console.error('Auth error:', event.data.error);
            showError('Ошибка авторизации: ' + event.data.error);
        }
    });
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
    // Проверяем авторизацию
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
        openAuthWindow();
    } else {
        connectWebSocket();
    }
}); 
