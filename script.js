document.addEventListener('DOMContentLoaded', () => {
    // Плавная прокрутка для навигации
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Анимация появления элементов при прокрутке
    const observerOptions = {
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    // Наблюдаем за секциями
    document.querySelectorAll('section').forEach(section => {
        section.classList.add('fade-in');
        observer.observe(section);
    });

    // Добавляем эффект параллакса для hero секции
    const hero = document.querySelector('.hero');
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        hero.style.backgroundPositionY = scrolled * 0.5 + 'px';
    });

    const modal = document.getElementById('detailsModal');
    const closeBtn = modal.querySelector('.modal-close');
    const detailsButtons = document.querySelectorAll('.details-btn');

    // Функция для открытия модального окна
    function openModal(card) {
        const title = card.querySelector('h3').textContent;
        const description = card.querySelector('.hidden-content p').textContent;
        const price = card.querySelector('.price').textContent;
        const features = Array.from(card.querySelectorAll('.hidden-content .features li')).map(li => li.textContent);

        modal.querySelector('.modal-title').textContent = title;
        modal.querySelector('.modal-description').textContent = description;
        modal.querySelector('.modal-price').textContent = price;

        const featuresList = modal.querySelector('.modal-features');
        featuresList.innerHTML = '';
        features.forEach(feature => {
            const li = document.createElement('li');
            li.textContent = feature;
            featuresList.appendChild(li);
        });

        modal.classList.add('active');
    }

    // Функция для закрытия модального окна
    function closeModal() {
        modal.classList.remove('active');
    }

    // Обработчики событий
    detailsButtons.forEach(button => {
        button.addEventListener('click', () => {
            const card = button.closest('.donate-card, .lornik-card');
            openModal(card);
        });
    });

    closeBtn.addEventListener('click', closeModal);

    // Закрытие по клику вне модального окна
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Закрытие по нажатию Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}); 