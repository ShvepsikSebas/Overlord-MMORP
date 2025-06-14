class AudioPlayer {
    constructor() {
        this.audio = new Audio('phomusic');
        this.isPlaying = localStorage.getItem('isPlaying') === 'true';
        this.currentTime = parseFloat(localStorage.getItem('currentTime')) || 0;
        this.volume = parseFloat(localStorage.getItem('volume')) || 0.5;
        
        this.createPlayer();
        this.setupEventListeners();
        this.restoreState();
    }

    createPlayer() {
        const player = document.createElement('div');
        player.className = 'audio-player';
        player.innerHTML = `
            <div class="player-controls">
                <button class="play-pause">
                    <i class="fas ${this.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                </button>
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress"></div>
                    </div>
                    <div class="time">0:00 / 0:00</div>
                </div>
                <div class="volume-control">
                    <i class="fas fa-volume-up"></i>
                    <input type="range" min="0" max="1" step="0.1" value="${this.volume}">
                </div>
            </div>
        `;

        // Добавляем стили
        const style = document.createElement('style');
        style.textContent = `
            .audio-player {
                position: fixed;
                left: 20px;
                top: 50%;
                transform: translateY(-50%);
                background: rgba(0, 0, 0, 0.8);
                padding: 15px;
                border-radius: 10px;
                z-index: 1000;
                color: white;
                font-family: Arial, sans-serif;
            }

            .player-controls {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .play-pause {
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                font-size: 20px;
            }

            .progress-container {
                flex: 1;
                min-width: 200px;
            }

            .progress-bar {
                background: rgba(255, 255, 255, 0.2);
                height: 5px;
                border-radius: 3px;
                cursor: pointer;
                position: relative;
            }

            .progress {
                background: #1DB954;
                height: 100%;
                border-radius: 3px;
                width: 0%;
            }

            .time {
                font-size: 12px;
                margin-top: 5px;
            }

            .volume-control {
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .volume-control input {
                width: 80px;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(player);

        this.player = player;
        this.playPauseBtn = player.querySelector('.play-pause');
        this.progressBar = player.querySelector('.progress-bar');
        this.progress = player.querySelector('.progress');
        this.timeDisplay = player.querySelector('.time');
        this.volumeControl = player.querySelector('.volume-control input');
    }

    setupEventListeners() {
        this.playPauseBtn.addEventListener('click', () => this.togglePlay());
        this.progressBar.addEventListener('click', (e) => this.setProgress(e));
        this.volumeControl.addEventListener('input', (e) => this.setVolume(e));
        
        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('ended', () => this.handleEnded());
        
        // Сохраняем состояние при изменении
        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            localStorage.setItem('isPlaying', 'true');
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        });
        
        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            localStorage.setItem('isPlaying', 'false');
            this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        });
        
        this.audio.addEventListener('timeupdate', () => {
            localStorage.setItem('currentTime', this.audio.currentTime);
        });
    }

    restoreState() {
        this.audio.volume = this.volume;
        this.audio.currentTime = this.currentTime;
        if (this.isPlaying) {
            this.audio.play();
        }
    }

    togglePlay() {
        if (this.isPlaying) {
            this.audio.pause();
        } else {
            this.audio.play();
        }
    }

    setProgress(e) {
        const width = this.progressBar.clientWidth;
        const clickX = e.offsetX;
        const duration = this.audio.duration;
        this.audio.currentTime = (clickX / width) * duration;
    }

    updateProgress() {
        const { currentTime, duration } = this.audio;
        const progressPercent = (currentTime / duration) * 100;
        this.progress.style.width = `${progressPercent}%`;
        
        const currentMinutes = Math.floor(currentTime / 60);
        const currentSeconds = Math.floor(currentTime % 60);
        const durationMinutes = Math.floor(duration / 60);
        const durationSeconds = Math.floor(duration % 60);
        
        this.timeDisplay.textContent = `${currentMinutes}:${currentSeconds.toString().padStart(2, '0')} / ${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}`;
    }

    setVolume(e) {
        const volume = e.target.value;
        this.audio.volume = volume;
        localStorage.setItem('volume', volume);
    }

    handleEnded() {
        this.isPlaying = false;
        localStorage.setItem('isPlaying', 'false');
        this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
}

// Инициализация плеера
document.addEventListener('DOMContentLoaded', () => {
    new AudioPlayer();
}); 