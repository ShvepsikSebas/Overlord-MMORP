document.addEventListener('DOMContentLoaded', () => {
    // Анимация появления карточек фракций
    const factionCards = document.querySelectorAll('.faction-card');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, {
        threshold: 0.1
    });

    factionCards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(50px)';
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(card);
    });

    // Анимация временной шкалы
    const timelineItems = document.querySelectorAll('.timeline-item');
    
    timelineItems.forEach(item => {
        observer.observe(item);
        item.style.opacity = '0';
        item.style.transform = 'translateX(-50px)';
        item.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    });

    observer.observe(document.querySelector('.guild-info'));
});

// Добавляем эффект параллакса для заголовка
window.addEventListener('scroll', () => {
    const hero = document.querySelector('.hero');
    const scrolled = window.pageYOffset;
    hero.style.backgroundPositionY = scrolled * 0.5 + 'px';
});

// Добавляем анимацию для текста
const textAnimation = () => {
    const title = document.querySelector('.title');
    const subtitle = document.querySelector('.subtitle');
    
    title.style.textShadow = `0 0 ${Math.random() * 20}px var(--secondary-color)`;
    subtitle.style.textShadow = `0 0 ${Math.random() * 10}px var(--secondary-color)`;
    
    requestAnimationFrame(textAnimation);
};

textAnimation();

function showRaceDetails(race) {
    const details = {
        elves: {
            title: 'Эльфы',
            description: 'Древнейшая раса Средиземья. Бессмертные существа, обладающие великой мудростью и красотой. Мастера в искусстве и магии.',
            image: 'https://wallpaperaccess.com/full/1098150.jpg'
        },
        dwarves: {
            title: 'Гномы',
            description: 'Искусные мастера и храбрые воины. Живут в величественных подземных городах. Славятся своим мастерством в обработке металлов и камня.',
            image: 'https://wallpaperaccess.com/full/1098150.jpg'
        },
        humans: {
            title: 'Люди',
            description: 'Свободолюбивый народ, стремящийся к величию. Хотя их век короток, они способны на великие подвиги и достижения.',
            image: 'https://wallpaperaccess.com/full/1098150.jpg'
        },
        hobbits: {
            title: 'Хоббиты',
            description: 'Миролюбивый народ, любящий комфорт и хорошую еду. Несмотря на свой размер, способны на невероятную храбрость и преданность.',
            image: 'https://wallpaperaccess.com/full/1098150.jpg'
        }
    };

    const detail = details[race];
    
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close">&times;</span>
            <h2>${detail.title}</h2>
            <p>${detail.description}</p>
        </div>
    `;

    document.body.appendChild(modal);

    // Анимация появления
    setTimeout(() => {
        modal.style.opacity = '1';
    }, 10);

    // Закрытие модального окна
    const closeBtn = modal.querySelector('.close');
    closeBtn.onclick = () => {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.remove();
        }, 300);
    };

    // Закрытие по клику вне модального окна
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.opacity = '0';
            setTimeout(() => {
                modal.remove();
            }, 300);
        }
    };
}

// Добавляем стили для модального окна
const style = document.createElement('style');
style.textContent = `
    .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: 1000;
    }

    .modal-content {
        background: var(--background-color);
        padding: 2rem;
        border-radius: 10px;
        max-width: 500px;
        width: 90%;
        position: relative;
        border: 1px solid var(--secondary-color);
    }

    .close {
        position: absolute;
        right: 1rem;
        top: 1rem;
        font-size: 1.5rem;
        cursor: pointer;
        color: var(--secondary-color);
    }

    .close:hover {
        color: var(--text-color);
    }
`;
document.head.appendChild(style); 