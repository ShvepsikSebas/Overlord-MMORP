// Load Font Awesome
const fontAwesome = document.createElement('link');
fontAwesome.rel = 'stylesheet';
fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css';
document.head.appendChild(fontAwesome);

// Load audio player
const audioPlayerScript = document.createElement('script');
audioPlayerScript.src = 'audio-player.js';
document.body.appendChild(audioPlayerScript);

// Common functionality
document.addEventListener('DOMContentLoaded', () => {
    // Add "To Top" button functionality
    const toTopButtons = document.querySelectorAll('.to-top');
    toTopButtons.forEach(button => {
        button.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // Add fade-in animation to navigation
    const nav = document.querySelector('.nav');
    if (nav) {
        nav.classList.add('fade-in');
    }
}); 
