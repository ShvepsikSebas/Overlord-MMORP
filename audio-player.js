class AudioPlayer {
    constructor() {
        console.log('Initializing AudioPlayer');
        this.audio = new Audio('https://overlord-mmorp.onrender.com/phonmusic.mp3');
        this.audio.loop = true;
        this.isPlaying = localStorage.getItem('isPlaying') === 'true' || false;
        this.currentTime = parseFloat(localStorage.getItem('currentTime')) || 0;
        this.volume = parseFloat(localStorage.getItem('volume')) || 0.1;
        
        // Проверяем загрузку аудио
        this.audio.addEventListener('error', (e) => {
            console.error('Error loading audio:', e);
        });
        
        this.audio.addEventListener('loadeddata', () => {
            console.log('Audio loaded successfully');
        });
        
        this.createPlayer();
        this.setupEventListeners();
        this.restoreState();
    }

    createPlayer() {
        console.log('Creating audio player UI');
        const player = document.createElement('div');
        player.className = 'audio-player';
        player.innerHTML = `
            <div class="player-controls">
                <button class="play-pause">
                    <i class="fas ${this.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                </button>
                <button class="rewind">
                    <i class="fas fa-backward"></i>
                </button>
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress"></div>
                    </div>
                    <div class="time">0:00 / 0:00</div>
                </div>
                <div class="volume-control">
                    <i class="fas fa-volume-up"></i>
                    <input type="range" min="0" max="1" step="0.01" value="${this.volume}">
                </div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .audio-player {
                position: fixed;
                left: 20px;
                bottom: 20px;
                background: rgba(0, 0, 0, 0.8);
                padding: 15px;
                border-radius: 10px;
                z-index: 1000;
                color: white;
                font-family: Arial, sans-serif;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
            }

            .player-controls {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .play-pause, .rewind {
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                font-size: 20px;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background-color 0.3s;
            }

            .play-pause:hover, .rewind:hover {
                background-color: rgba(255, 255, 255, 0.1);
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
                transition: width 0.1s linear;
            }

            .time {
                font-size: 12px;
                margin-top: 5px;
                color: rgba(255, 255, 255, 0.7);
            }

            .volume-control {
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .volume-control input {
                width: 80px;
                cursor: pointer;
            }

            .volume-control i {
                cursor: pointer;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(player);

        this.player = player;
        this.playPauseBtn = player.querySelector('.play-pause');
        this.rewindBtn = player.querySelector('.rewind');
        this.progressBar = player.querySelector('.progress-bar');
        this.progress = player.querySelector('.progress');
        this.timeDisplay = player.querySelector('.time');
        this.volumeControl = player.querySelector('.volume-control input');
        
        console.log('Audio player UI created successfully');
    }

    setupEventListeners() {
        console.log('Setting up event listeners');
        this.playPauseBtn.addEventListener('click', () => this.togglePlay());
        this.rewindBtn.addEventListener('click', () => this.rewind());
        this.progressBar.addEventListener('click', (e) => this.setProgress(e));
        this.volumeControl.addEventListener('input', (e) => this.setVolume(e));
        
        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('ended', () => this.handleEnded());
        this.audio.addEventListener('loadedmetadata', () => this.updateProgress());
        
        // Save state on changes
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

        // Handle page visibility changes
        // document.addEventListener('visibilitychange', () => {
        //     if (document.hidden) {
        //         this.audio.pause();
        //     } else if (this.isPlaying) {
        //         this.audio.play();
        //     }
        // });
        
        console.log('Event listeners set up successfully');
    }

    restoreState() {
        console.log('Restoring player state');
        this.audio.volume = this.volume;
        this.audio.currentTime = this.currentTime;
        if (this.isPlaying) {
            this.audio.play().catch((error) => {
                console.error('Error playing audio:', error);
                // Handle autoplay restrictions
                this.isPlaying = false;
                localStorage.setItem('isPlaying', 'false');
                this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            });
        } else {
            this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        }
    }

    togglePlay() {
        if (this.isPlaying) {
            this.audio.pause();
        } else {
            this.audio.play().catch((error) => {
                console.error('Error playing audio:', error);
                // Handle autoplay restrictions
                this.isPlaying = false;
                localStorage.setItem('isPlaying', 'false');
                this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            });
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
        if (isNaN(duration)) return;
        
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

    rewind() {
        this.audio.currentTime = 0;
        this.audio.play().catch((error) => {
            console.error('Error rewinding and playing audio:', error);
        });
    }

    handleEnded() {
        this.isPlaying = false;
        localStorage.setItem('isPlaying', 'false');
        this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        this.audio.currentTime = 0;
    }
}

// Initialize player when DOM is loaded
// document.addEventListener('DOMContentLoaded', () => {
//     console.log('DOM loaded, creating audio player');
//     new AudioPlayer();
// }); 
