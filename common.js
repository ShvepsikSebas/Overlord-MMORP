// Добавляем Font Awesome
const fontAwesome = document.createElement('link');
fontAwesome.rel = 'stylesheet';
fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css';
document.head.appendChild(fontAwesome);

// Подключаем аудиоплеер
const audioPlayerScript = document.createElement('script');
audioPlayerScript.src = 'audio-player.js';
document.body.appendChild(audioPlayerScript); 