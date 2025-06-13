const GITHUB_USERNAME = 'overlordgmod';
const GITHUB_REPO = 'Overlord-MMORP';
const GITHUB_BRANCH = 'main';

// ВНИМАНИЕ: Для локального тестирования вы можете вставить ваш Personal Access Token сюда.
// Для публичного сайта на GitHub Pages, хранение токена в клиентском JavaScript НЕБЕЗОПАСНО!
// Для продакшна используйте более безопасные методы, такие как GitHub Actions secrets
const GITHUB_TOKEN = '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'; // Вставьте сюда ваш токен

const API_BASE_URL = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents`;

async function githubFetch(url, options = {}) {
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorData.message || 'Unknown error'}`);
    }
    
    return response;
}

// Функция для получения объявлений
export async function getAnnouncements() {
    try {
        const response = await githubFetch(`${API_BASE_URL}/announcements.json?ref=${GITHUB_BRANCH}`);
        const data = await response.json();
        // Декодируем содержимое из Base64 и парсим JSON
        const content = JSON.parse(atob(data.content));
        return content;
    } catch (error) {
        console.error('Error fetching announcements from GitHub:', error);
        // Если файл не найден или ошибка парсинга, возвращаем пустой массив
        if (error.message.includes('Not Found') || error.message.includes('404')) {
            return [];
        }
        throw error; // Перебрасываем другие ошибки
    }
}

// Функция для получения SHA файла
async function getFileSha(path) {
    try {
        const response = await githubFetch(`${API_BASE_URL}/${path}?ref=${GITHUB_BRANCH}`);
        const data = await response.json();
        return data.sha;
    } catch (error) {
        if (error.message.includes('Not Found') || error.message.includes('404')) {
            return null; // Файл не существует
        }
        console.error(`Error getting SHA for ${path}:`, error);
        throw error;
    }
}

// Функция для загрузки или обновления файла
async function uploadFile(path, content, message, sha = null) {
    const payload = {
        message: message,
        content: btoa(unescape(encodeURIComponent(content))), // Кодируем в Base64
        branch: GITHUB_BRANCH,
    };
    if (sha) {
        payload.sha = sha;
    }

    const response = await githubFetch(`${API_BASE_URL}/${path}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    return response.json();
}

// Функция для отправки нового объявления
export async function submitAnnouncement(title, content, imageFile) {
    let imageUrl = null;

    if (imageFile) {
        // 1. Загружаем изображение
        const reader = new FileReader();
        const imageData = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result.split(', ')[1]); // Получаем только Base64 часть
            reader.onerror = error => reject(error);
            reader.readAsDataURL(imageFile);
        });
        
        const imagePath = `uploads/${Date.now()}_${imageFile.name}`;
        const imageSha = await getFileSha(imagePath);

        await uploadFile(imagePath, atob(imageData), `Add image for ${title}`, imageSha);
        imageUrl = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${GITHUB_REPO}/${GITHUB_BRANCH}/${imagePath}`; // Raw URL для отображения
    }

    // 2. Обновляем announcements.json
    const announcements = await getAnnouncements();
    const newAnnouncement = {
        id: Date.now(),
        title: title,
        content: content,
        image: imageUrl,
        date: new Date().toISOString()
    };

    announcements.unshift(newAnnouncement); // Добавляем новое в начало
    
    // Ограничиваем количество объявлений до 4
    if (announcements.length > 4) {
        announcements.length = 4;
    }

    const announcementsJson = JSON.stringify(announcements, null, 2);
    const announcementsSha = await getFileSha('announcements.json');

    await uploadFile('announcements.json', announcementsJson, 'Update announcements', announcementsSha);
} 
