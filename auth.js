const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const config = require('./config.json');
const { db } = require('./firebase');

// Конфигурация Discord OAuth2
const DISCORD_CLIENT_ID = config.discord.clientId;
const DISCORD_CLIENT_SECRET = config.discord.clientSecret;
const REDIRECT_URI = config.discord.redirectUri;
const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';

// Инициализация Firebase
const sessionsRef = db.ref('sessions');
const blockedUsersRef = db.ref('blockedUsers');
const authAttemptsRef = db.ref('authAttempts');

// Константы для ограничения запросов
const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 минут
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 часа

// Функция для проверки ограничения запросов
async function checkRateLimit(ip) {
    try {
        const attemptRef = authAttemptsRef.child(ip);
        const snapshot = await attemptRef.once('value');
        const attempt = snapshot.val() || { count: 0, lastAttempt: Date.now() };
        
        const now = Date.now();
        if (now - attempt.lastAttempt > AUTH_WINDOW_MS) {
            attempt.count = 0;
        }
        
        attempt.lastAttempt = now;
        attempt.count++;
        await attemptRef.set(attempt);
        
        return attempt.count <= MAX_AUTH_ATTEMPTS;
    } catch (error) {
        console.error('Error checking rate limit:', error);
        return true; // В случае ошибки разрешаем запрос
    }
}

// Генерация URL для авторизации через Discord
router.get('/discord', async (req, res) => {
    const clientIP = req.ip;
    
    // Проверяем ограничение запросов
    if (!(await checkRateLimit(clientIP))) {
        console.log(`Rate limit exceeded for IP: ${clientIP}`);
        return res.status(429).json({ error: 'Слишком много попыток авторизации. Попробуйте позже.' });
    }

    // Проверяем существующую сессию
    const existingSessionId = req.cookies.sessionId;
    if (existingSessionId) {
        const sessionSnapshot = await sessionsRef.child(existingSessionId).once('value');
        const session = sessionSnapshot.val();
        
        if (session && session.expiresAt && Date.now() < session.expiresAt) {
            console.log('User already has a valid session, redirecting to main page');
            return res.redirect('/');
        }
    }

    const state = Math.random().toString(36).substring(7);
    const scopes = config.discord.scopes.join(' ');
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`;
    res.redirect(url);
});

// Обработка callback от Discord
router.get('/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        console.error('No code received from Discord');
        return res.redirect('/?error=no_code');
    }

    try {
        // Получение токена доступа
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI,
                scope: config.discord.scopes.join(' '),
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const tokens = await tokenResponse.json();

        if (!tokens.access_token) {
            console.error('No access token received:', tokens);
            return res.redirect('/?error=no_access_token');
        }

        // Получение информации о пользователе
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        const user = await userResponse.json();

        if (!user.id) {
            console.error('No user data received:', user);
            return res.redirect('/?error=no_user_data');
        }

        // Создание сессии
        const sessionId = Math.random().toString(36).substring(7);
        const session = {
            userId: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + SESSION_DURATION
        };

        // Сохраняем сессию в Firebase
        await sessionsRef.child(sessionId).set(session);

        // Устанавливаем cookie
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: SESSION_DURATION
        });

        // Отправляем HTML страницу, которая закроет окно авторизации и отправит сообщение родительскому окну
        res.send(`
            <html>
                <body>
                    <script>
                        window.opener.postMessage({
                            type: 'authSuccess',
                            sessionId: '${sessionId}',
                            user: ${JSON.stringify({
                                id: user.id,
                                username: user.username,
                                discriminator: user.discriminator,
                                avatar: user.avatar
                            })}
                        }, '*');
                        window.close();
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('Error during Discord authentication:', error);
        res.redirect('/?error=auth_failed');
    }
});

// Проверка сессии
router.get('/session', async (req, res) => {
    const sessionId = req.cookies.sessionId;
    
    if (!sessionId) {
        return res.json({ authenticated: false });
    }

    try {
        const sessionSnapshot = await sessionsRef.child(sessionId).once('value');
        const session = sessionSnapshot.val();

        if (!session) {
            return res.json({ authenticated: false });
        }

        // Проверяем срок действия сессии
        if (session.expiresAt && Date.now() > session.expiresAt) {
            await sessionsRef.child(sessionId).remove();
            res.clearCookie('sessionId');
            return res.json({ authenticated: false });
        }

        // Проверяем валидность токена Discord
        const response = await fetch('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${session.accessToken}`,
            },
        });

        if (!response.ok) {
            console.log('Discord token invalid, removing session...');
            await sessionsRef.child(sessionId).remove();
            res.clearCookie('sessionId');
            return res.json({ authenticated: false });
        }

        res.json({
            authenticated: true,
            user: {
                id: session.userId,
                username: session.username,
                discriminator: session.discriminator,
                avatar: session.avatar,
            },
        });
    } catch (error) {
        console.error('Error checking session:', error);
        res.json({ authenticated: false });
    }
});

// Выход из системы
router.post('/logout', async (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
        await sessionsRef.child(sessionId).remove();
    }
    res.clearCookie('sessionId');
    res.json({ success: true });
});

// Проверка блокировки пользователя
router.get('/check-block/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const blockSnapshot = await blockedUsersRef.child(userId).once('value');
        const blockData = blockSnapshot.val();

        if (!blockData) {
            return res.json({ blocked: false });
        }

        if (Date.now() > blockData.until) {
            await blockedUsersRef.child(userId).remove();
            return res.json({ blocked: false });
        }

        res.json({
            blocked: true,
            until: blockData.until,
            reason: blockData.reason
        });
    } catch (error) {
        console.error('Error checking user block:', error);
        res.json({ blocked: false });
    }
});

module.exports = {
    router,
    sessionsRef,
    blockedUsersRef
}; 
