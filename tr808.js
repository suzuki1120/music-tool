/**
 * TR-808 style drum voices (synthesised, polyphonic — one node graph per hit).
 *
 * trigger(id, time, { accent, velocity })
 *   accent   : louder / snappier hit (pattern cell value 2)
 *   velocity : 0..1 multiplier (stutter decay etc.)
 */
class TR808 {
    constructor(engine) {
        this.engine = engine;
        this.volumes = {};
        this.out = null;
        this._openHat = null; // { gain, src } for choke

        this.instruments = [
            { id: 'kick',    name: 'BD',  longName: 'BASS DRUM',    defaultVol: 1.0 },
            { id: 'snare',   name: 'SD',  longName: 'SNARE',        defaultVol: 0.8 },
            { id: 'clap',    name: 'CP',  longName: 'HAND CLAP',    defaultVol: 0.7 },
            { id: 'hihat_c', name: 'CH',  longName: 'CLOSED HAT',   defaultVol: 0.6 },
            { id: 'hihat_o', name: 'OH',  longName: 'OPEN HAT',     defaultVol: 0.55 },
            { id: 'tom_lo',  name: 'LT',  longName: 'LOW TOM',      defaultVol: 0.7 },
            { id: 'tom_hi',  name: 'HT',  longName: 'HIGH TOM',     defaultVol: 0.7 },
            { id: 'cymbal',  name: 'CY',  longName: 'CYMBAL',       defaultVol: 0.45 },
            { id: 'rimshot', name: 'RS',  longName: 'RIM SHOT',     defaultVol: 0.6 },
            { id: 'cowbell', name: 'CB',  longName: 'COWBELL',      defaultVol: 0.5 }
        ];

        this.instruments.forEach(inst => {
            this.volumes[inst.id] = inst.defaultVol;
        });
    }

    init() {
        if (this.out || !this.engine.ctx) return;
        this.out = this.engine.ctx.createGain();
        this.out.gain.value = 1;
        this.out.connect(this.engine.dest);
        this.engine.getNoiseBuffer();
    }

    setVolume(instrumentId, value) {
        this.volumes[instrumentId] = Math.max(0, Math.min(1, value));
    }

    trigger(instrumentId, time, opts = {}) {
        if (!this.out) this.init();
        if (!this.out) return;
        const { accent = false, velocity = 1 } = opts;
        const vol = (this.volumes[instrumentId] ?? 0.7) * (accent ? 1.45 : 1) * velocity;
        if (vol <= 0.002) return;

        const ctx = this.engine.ctx;
        const dest = this.out;
        const pf = this.engine.pitchFactor || 1;

        switch (instrumentId) {
            case 'kick':    this._kick(ctx, dest, time, vol, pf, accent); break;
            case 'snare':   this._snare(ctx, dest, time, vol, pf); break;
            case 'clap':    this._clap(ctx, dest, time, vol); break;
            case 'hihat_c': this._hihat(ctx, dest, time, vol, pf, false); break;
            case 'hihat_o': this._hihat(ctx, dest, time, vol, pf, true); break;
            case 'tom_lo':  this._tom(ctx, dest, time, vol, 90 * pf); break;
            case 'tom_hi':  this._tom(ctx, dest, time, vol, 160 * pf); break;
            case 'cymbal':  this._cymbal(ctx, dest, time, vol, pf); break;
            case 'rimshot': this._rimshot(ctx, dest, time, vol, pf); break;
            case 'cowbell': this._cowbell(ctx, dest, time, vol, pf); break;
        }
    }

    // ---------------------------------------------------------------- helpers
    _noise(ctx, time, dur) {
        const src = ctx.createBufferSource();
        src.buffer = this.engine.getNoiseBuffer();
        src.start(time);
        src.stop(time + dur + 0.05);
        return src;
    }

    /** Six detuned square waves — the classic 808 metallic source for hats / cymbal. */
    _metal(ctx, time, dur, pf) {
        const ratios = [205.3, 304.4, 369.6, 522.7, 540, 800];
        const sum = ctx.createGain();
        sum.gain.value = 1 / ratios.length;
        ratios.forEach(f => {
            const o = ctx.createOscillator();
            o.type = 'square';
            o.frequency.value = f * pf;
            o.connect(sum);
            o.start(time);
            o.stop(time + dur + 0.05);
        });
        return sum;
    }

    // ----------------------------------------------------------------- voices
    _kick(ctx, dest, time, vol, pf, accent) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(165 * pf, time);
        osc.frequency.exponentialRampToValueAtTime(48 * pf, time + 0.09);
        osc.frequency.exponentialRampToValueAtTime(42 * pf, time + 0.4);
        gain.gain.setValueAtTime(vol * 1.1, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + (accent ? 0.55 : 0.45));
        osc.connect(gain);
        gain.connect(dest);
        osc.start(time);
        osc.stop(time + 0.6);

        // Click transient for punch
        const click = this._noise(ctx, time, 0.02);
        const clickHp = ctx.createBiquadFilter();
        clickHp.type = 'highpass';
        clickHp.frequency.value = 1500;
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(vol * 0.35, time);
        clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.015);
        click.connect(clickHp);
        clickHp.connect(clickGain);
        clickGain.connect(dest);
    }

    _snare(ctx, dest, time, vol, pf) {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(230 * pf, time);
        osc.frequency.exponentialRampToValueAtTime(150 * pf, time + 0.04);
        oscGain.gain.setValueAtTime(vol * 0.6, time);
        oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
        osc.connect(oscGain);
        oscGain.connect(dest);
        osc.start(time);
        osc.stop(time + 0.15);

        const noise = this._noise(ctx, time, 0.25);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2200;
        bp.Q.value = 0.8;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 900;
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(vol * 0.7, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
        noise.connect(bp);
        bp.connect(hp);
        hp.connect(noiseGain);
        noiseGain.connect(dest);
    }

    _clap(ctx, dest, time, vol) {
        const noise = this._noise(ctx, time, 0.35);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1600;
        bp.Q.value = 1.1;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 700;
        const gain = ctx.createGain();
        const g = gain.gain;
        g.setValueAtTime(0.0001, time);
        // Three quick bursts then a tail
        [0, 0.011, 0.022].forEach(off => {
            g.setValueAtTime(vol * 0.9, time + off);
            g.exponentialRampToValueAtTime(vol * 0.25, time + off + 0.009);
        });
        g.setValueAtTime(vol * 0.95, time + 0.033);
        g.exponentialRampToValueAtTime(0.001, time + 0.3);
        noise.connect(bp);
        bp.connect(hp);
        hp.connect(gain);
        gain.connect(dest);
    }

    _hihat(ctx, dest, time, vol, pf, open) {
        // Choke: a new hat (open or closed) cuts a ringing open hat
        if (this._openHat) {
            try {
                this._openHat.gain.gain.cancelScheduledValues(time);
                this._openHat.gain.gain.setTargetAtTime(0, time, 0.006);
            } catch (e) { /* node already finished */ }
            this._openHat = null;
        }

        const dur = open ? 0.42 : 0.07;
        const src = this._metal(ctx, time, dur, pf);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 9500;
        bp.Q.value = 0.7;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7200;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol * (open ? 0.5 : 0.55), time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        src.connect(bp);
        bp.connect(hp);
        hp.connect(gain);
        gain.connect(dest);

        if (open) this._openHat = { gain };
    }

    _tom(ctx, dest, time, vol, freq) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 1.6, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.06);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.7, time + 0.35);
        gain.gain.setValueAtTime(vol * 0.85, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.38);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(time);
        osc.stop(time + 0.4);

        const noise = this._noise(ctx, time, 0.05);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = freq * 4;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.2, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        noise.connect(bp);
        bp.connect(ng);
        ng.connect(dest);
    }

    _cymbal(ctx, dest, time, vol, pf) {
        const dur = 1.1;
        const src = this._metal(ctx, time, dur, pf);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 7000;
        bp.Q.value = 0.5;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 5000;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol * 0.5, time);
        gain.gain.exponentialRampToValueAtTime(vol * 0.18, time + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        src.connect(bp);
        bp.connect(hp);
        hp.connect(gain);
        gain.connect(dest);

        const noise = this._noise(ctx, time, 0.6);
        const nhp = ctx.createBiquadFilter();
        nhp.type = 'highpass';
        nhp.frequency.value = 9000;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.25, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
        noise.connect(nhp);
        nhp.connect(ng);
        ng.connect(dest);
    }

    _rimshot(ctx, dest, time, vol, pf) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1750 * pf, time);
        gain.gain.setValueAtTime(vol * 0.35, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(time);
        osc.stop(time + 0.04);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(480 * pf, time);
        osc2.frequency.exponentialRampToValueAtTime(330 * pf, time + 0.03);
        gain2.gain.setValueAtTime(vol * 0.7, time);
        gain2.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
        osc2.connect(gain2);
        gain2.connect(dest);
        osc2.start(time);
        osc2.stop(time + 0.06);

        const noise = this._noise(ctx, time, 0.03);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 3500;
        bp.Q.value = 2;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.3, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
        noise.connect(bp);
        bp.connect(ng);
        ng.connect(dest);
    }

    _cowbell(ctx, dest, time, vol, pf) {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        const bp = ctx.createBiquadFilter();
        osc1.type = 'square';
        osc1.frequency.value = 540 * pf;
        osc2.type = 'square';
        osc2.frequency.value = 800 * pf;
        bp.type = 'bandpass';
        bp.frequency.value = 1400;
        bp.Q.value = 1.2;
        gain.gain.setValueAtTime(vol * 0.55, time);
        gain.gain.exponentialRampToValueAtTime(vol * 0.2, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
        osc1.connect(bp);
        osc2.connect(bp);
        bp.connect(gain);
        gain.connect(dest);
        osc1.start(time);
        osc2.start(time);
        osc1.stop(time + 0.35);
        osc2.stop(time + 0.35);
    }
}
