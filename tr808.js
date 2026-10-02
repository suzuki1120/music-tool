class TR808 {
    constructor(engine) {
        this.engine = engine;
        this.channels = {};
        this.volumes = {};
        this.noiseBuffer = null;

        this.instruments = [
            { id: 'kick', name: 'KICK', defaultVol: 1.0 },
            { id: 'snare', name: 'SNARE', defaultVol: 0.8 },
            { id: 'clap', name: 'CLAP', defaultVol: 0.7 },
            { id: 'hihat_c', name: 'HH CL', defaultVol: 0.6 },
            { id: 'hihat_o', name: 'HH OP', defaultVol: 0.6 },
            { id: 'tom_lo', name: 'TOM LO', defaultVol: 0.7 },
            { id: 'tom_hi', name: 'TOM HI', defaultVol: 0.7 },
            { id: 'cymbal', name: 'CYMBAL', defaultVol: 0.5 },
            { id: 'rimshot', name: 'RIM', defaultVol: 0.6 },
            { id: 'cowbell', name: 'COWBELL', defaultVol: 0.5 }
        ];

        this.instruments.forEach(inst => {
            this.volumes[inst.id] = inst.defaultVol;
        });
    }

    init() {
        this.noiseBuffer = this.engine.createNoiseBuffer(2);
    }

    setVolume(instrumentId, value) {
        this.volumes[instrumentId] = value;
    }

    trigger(instrumentId, time, accent = false) {
        const vol = this.volumes[instrumentId] * (accent ? 1.3 : 1.0);
        const ctx = this.engine.ctx;
        const dest = this.engine.masterGain;

        switch (instrumentId) {
            case 'kick': this._kick(ctx, dest, time, vol); break;
            case 'snare': this._snare(ctx, dest, time, vol); break;
            case 'clap': this._clap(ctx, dest, time, vol); break;
            case 'hihat_c': this._hihatClosed(ctx, dest, time, vol); break;
            case 'hihat_o': this._hihatOpen(ctx, dest, time, vol); break;
            case 'tom_lo': this._tom(ctx, dest, time, vol, 80); break;
            case 'tom_hi': this._tom(ctx, dest, time, vol, 140); break;
            case 'cymbal': this._cymbal(ctx, dest, time, vol); break;
            case 'rimshot': this._rimshot(ctx, dest, time, vol); break;
            case 'cowbell': this._cowbell(ctx, dest, time, vol); break;
        }
    }

    _kick(ctx, dest, time, vol) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(30, time + 0.12);

        gain.gain.setValueAtTime(vol * 1.2, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(80, time);
        osc2.frequency.exponentialRampToValueAtTime(20, time + 0.2);

        gain2.gain.setValueAtTime(vol * 0.8, time);
        gain2.gain.exponentialRampToValueAtTime(0.001, time + 0.6);

        osc.connect(gain);
        osc2.connect(gain2);
        gain.connect(dest);
        gain2.connect(dest);

        osc.start(time);
        osc.stop(time + 0.5);
        osc2.start(time);
        osc2.stop(time + 0.6);
    }

    _snare(ctx, dest, time, vol) {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        const noise = ctx.createBufferSource();
        const noiseGain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, time);
        osc.frequency.exponentialRampToValueAtTime(100, time + 0.05);
        oscGain.gain.setValueAtTime(vol * 0.7, time);
        oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

        noise.buffer = this.noiseBuffer;
        filter.type = 'highpass';
        filter.frequency.value = 3000;
        noiseGain.gain.setValueAtTime(vol * 0.6, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

        osc.connect(oscGain);
        oscGain.connect(dest);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(dest);

        osc.start(time);
        osc.stop(time + 0.1);
        noise.start(time);
        noise.stop(time + 0.2);
    }

    _clap(ctx, dest, time, vol) {
        const noise = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        noise.buffer = this.noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.value = 2500;
        filter.Q.value = 3;

        gain.gain.setValueAtTime(0, time);
        gain.gain.setValueAtTime(vol * 0.8, time + 0.005);
        gain.gain.setValueAtTime(vol * 0.3, time + 0.01);
        gain.gain.setValueAtTime(vol * 0.8, time + 0.015);
        gain.gain.setValueAtTime(vol * 0.3, time + 0.02);
        gain.gain.setValueAtTime(vol * 0.9, time + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        noise.start(time);
        noise.stop(time + 0.3);
    }

    _hihatClosed(ctx, dest, time, vol) {
        const noise = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const hpFilter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        noise.buffer = this.noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.value = 10000;
        filter.Q.value = 1;
        hpFilter.type = 'highpass';
        hpFilter.frequency.value = 7000;

        gain.gain.setValueAtTime(vol * 0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

        noise.connect(filter);
        filter.connect(hpFilter);
        hpFilter.connect(gain);
        gain.connect(dest);

        noise.start(time);
        noise.stop(time + 0.06);
    }

    _hihatOpen(ctx, dest, time, vol) {
        const noise = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const hpFilter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        noise.buffer = this.noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.value = 10000;
        filter.Q.value = 1;
        hpFilter.type = 'highpass';
        hpFilter.frequency.value = 7000;

        gain.gain.setValueAtTime(vol * 0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

        noise.connect(filter);
        filter.connect(hpFilter);
        hpFilter.connect(gain);
        gain.connect(dest);

        noise.start(time);
        noise.stop(time + 0.4);
    }

    _tom(ctx, dest, time, vol, freq) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + 0.15);

        gain.gain.setValueAtTime(vol * 0.8, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

        osc.connect(gain);
        gain.connect(dest);

        osc.start(time);
        osc.stop(time + 0.3);
    }

    _cymbal(ctx, dest, time, vol) {
        const noise = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        noise.buffer = this.noiseBuffer;
        filter.type = 'highpass';
        filter.frequency.value = 8000;

        gain.gain.setValueAtTime(vol * 0.4, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.8);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        noise.start(time);
        noise.stop(time + 0.8);
    }

    _rimshot(ctx, dest, time, vol) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(1700, time);
        gain.gain.setValueAtTime(vol * 0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(400, time);
        gain2.gain.setValueAtTime(vol * 0.6, time);
        gain2.gain.exponentialRampToValueAtTime(0.001, time + 0.03);

        osc.connect(gain);
        osc2.connect(gain2);
        gain.connect(dest);
        gain2.connect(dest);

        osc.start(time);
        osc.stop(time + 0.02);
        osc2.start(time);
        osc2.stop(time + 0.03);
    }

    _cowbell(ctx, dest, time, vol) {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc1.type = 'square';
        osc1.frequency.value = 800;
        osc2.type = 'square';
        osc2.frequency.value = 540;

        filter.type = 'bandpass';
        filter.frequency.value = 800;
        filter.Q.value = 3;

        gain.gain.setValueAtTime(vol * 0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        osc1.start(time);
        osc1.stop(time + 0.15);
        osc2.start(time);
        osc2.stop(time + 0.15);
    }
}
