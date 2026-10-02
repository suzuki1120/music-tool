class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.compressor = null;
        this.isInitialized = false;
    }

    init() {
        if (this.isInitialized) return;

        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 10;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.75;

        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);

        this.isInitialized = true;
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    get currentTime() {
        return this.ctx ? this.ctx.currentTime : 0;
    }

    setMasterVolume(value) {
        if (this.masterGain) {
            this.masterGain.gain.value = value;
        }
    }

    createNoiseBuffer(duration = 1) {
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }
}

const audioEngine = new AudioEngine();
