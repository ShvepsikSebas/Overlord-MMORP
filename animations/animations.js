// Функция для добавления анимации к элементу
function addAnimation(element, animationClass) {
    element.classList.add(animationClass);
}

// Функция для удаления анимации
function removeAnimation(element, animationClass) {
    element.classList.remove(animationClass);
}

// Функция для анимации при появлении элемента в поле зрения
function animateOnScroll() {
    const elements = document.querySelectorAll('.animate-on-scroll');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('fade-in');
                observer.unobserve(entry.target);
            }
        });
    });

    elements.forEach(element => {
        observer.observe(element);
    });
}

// Инициализация анимаций при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    animateOnScroll();
}); 