/**
 * TR-808 / TR-909 style drum voices (synthesised, polyphonic — one node graph per hit)
 * plus four sampler rows (S1–S4) that delegate to the Sampler.
 *
 * trigger(id, time, { accent, velocity })
 *   accent   : louder / snappier hit (pattern cell value 2)
 *   velocity : 0..1 multiplier (stutter decay, humanize, ratchets)
 *
 * Every voice plays into its own mixer channel (engine.channelInput(id)), so level / pan /
 * mute / solo / sends live in the AudioEngine mixer. Per-voice kit: '808' or '909'.
 */
class TR808 {
    constructor(engine, sampler = null) {
        this.engine = engine;
        this.sampler = sampler;
        this._openHat = null; // { gain } for choke

        this.instruments = [
            { id: 'kick',    name: 'BD',  longName: 'BASS DRUM',    defaultVol: 1.0,  group: 'drum', midi: 36 },
            { id: 'snare',   name: 'SD',  longName: 'SNARE',        defaultVol: 0.8,  group: 'drum', midi: 38 },
            { id: 'clap',    name: 'CP',  longName: 'HAND CLAP',    defaultVol: 0.7,  group: 'drum', midi: 39 },
            { id: 'hihat_c', name: 'CH',  longName: 'CLOSED HAT',   defaultVol: 0.6,  group: 'drum', midi: 42 },
            { id: 'hihat_o', name: 'OH',  longName: 'OPEN HAT',     defaultVol: 0.55, group: 'drum', midi: 46 },
            { id: 'tom_lo',  name: 'LT',  longName: 'LOW TOM',      defaultVol: 0.7,  group: 'drum', midi: 45 },
            { id: 'tom_hi',  name: 'HT',  longName: 'HIGH TOM',     defaultVol: 0.7,  group: 'drum', midi: 50 },
            { id: 'cymbal',  name: 'CY',  longName: 'CYMBAL',       defaultVol: 0.45, group: 'drum', midi: 49 },
            { id: 'rimshot', name: 'RS',  longName: 'RIM SHOT',     defaultVol: 0.6,  group: 'drum', midi: 37 },
            { id: 'cowbell', name: 'CB',  longName: 'COWBELL',      defaultVol: 0.5,  group: 'drum', midi: 56 },
            { id: 's1',      name: 'S1',  longName: 'SAMPLE 1',     defaultVol: 0.8,  group: 'smp',  midi: 60 },
            { id: 's2',      name: 'S2',  longName: 'SAMPLE 2',     defaultVol: 0.8,  group: 'smp',  midi: 61 },
            { id: 's3',      name: 'S3',  longName: 'SAMPLE 3',     defaultVol: 0.8,  group: 'smp',  midi: 62 },
            { id: 's4',      name: 'S4',  longName: 'SAMPLE 4',     defaultVol: 0.8,  group: 'smp',  midi: 63 }
        ];
        this.KIT_CAPABLE = ['kick', 'snare', 'clap', 'hihat_c', 'hihat_o', 'tom_lo', 'tom_hi', 'cymbal', 'rimshot'];
        this.kit = {};
        this.KIT_CAPABLE.forEach(id => { this.kit[id] = '808'; });

        this.instruments.forEach(inst => {
            this.engine.mixState(inst.id).level = inst.defaultVol;
        });
    }

    init() {
        if (!this.engine.ctx) return;
        this.engine.getNoiseBuffer();
        this.instruments.forEach(inst => this.engine.channel(inst.id));
    }

    isSample(id) { return id[0] === 's' && id.length === 2; }
    sampleIndex(id) { return parseInt(id[1]) - 1; }

    // ---------------------------------------------------------------- level compat
    setVolume(instrumentId, value) { this.engine.setLevel(instrumentId, value); }
    get volumes() {
        const v = {};
        this.instruments.forEach(i => { v[i.id] = this.engine.mixState(i.id).level; });
        return v;
    }

    // ---------------------------------------------------------------- kits
    setKit(id, kit) {
        if (!this.KIT_CAPABLE.includes(id)) return;
        this.kit[id] = kit === '909' ? '909' : '808';
    }
    toggleKit(id) {
        if (!this.KIT_CAPABLE.includes(id)) return null;
        this.setKit(id, this.kit[id] === '808' ? '909' : '808');
        return this.kit[id];
    }
    setAllKits(kit) { this.KIT_CAPABLE.forEach(id => this.setKit(id, kit)); }
    getKits() { return { ...this.kit }; }
    setKits(map) { if (map) Object.keys(map).forEach(id => this.setKit(id, map[id])); }

    // ---------------------------------------------------------------- trigger
    trigger(instrumentId, time, opts = {}) {
        if (!this.engine.ctx) return;
        const { accent = false, velocity = 1 } = opts;
        if (this.engine.effectiveGain(instrumentId) <= 0.002) return;
        const vol = (accent ? 1.45 : 1) * velocity;
        if (vol <= 0.002) return;

        const ctx = this.engine.ctx;
        const dest = this.engine.channelInput(instrumentId);
        const pf = this.engine.pitchFactor || 1;

        if (this.isSample(instrumentId)) {
            if (this.sampler) this.sampler.trigger(this.sampleIndex(instrumentId), time, { accent, velocity }, dest);
            return;
        }

        const nine = this.kit[instrumentId] === '909';
        switch (instrumentId) {
            case 'kick':    nine ? this._kick909(ctx, dest, time, vol, pf, accent) : this._kick(ctx, dest, time, vol, pf, accent); break;
            case 'snare':   nine ? this._snare909(ctx, dest, time, vol, pf) : this._snare(ctx, dest, time, vol, pf); break;
            case 'clap':    nine ? this._clap909(ctx, dest, time, vol) : this._clap(ctx, dest, time, vol); break;
            case 'hihat_c': nine ? this._hihat909(ctx, dest, time, vol, pf, false) : this._hihat(ctx, dest, time, vol, pf, false); break;
            case 'hihat_o': nine ? this._hihat909(ctx, dest, time, vol, pf, true) : this._hihat(ctx, dest, time, vol, pf, true); break;
            case 'tom_lo':  nine ? this._tom909(ctx, dest, time, vol, 95 * pf) : this._tom(ctx, dest, time, vol, 90 * pf); break;
            case 'tom_hi':  nine ? this._tom909(ctx, dest, time, vol, 170 * pf) : this._tom(ctx, dest, time, vol, 160 * pf); break;
            case 'cymbal':  nine ? this._ride909(ctx, dest, time, vol, pf) : this._cymbal(ctx, dest, time, vol, pf); break;
            case 'rimshot': nine ? this._rim909(ctx, dest, time, vol, pf) : this._rimshot(ctx, dest, time, vol, pf); break;
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

    _softClip(ctx, amount) {
        const ws = ctx.createWaveShaper();
        const n = 512;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
        }
        ws.curve = curve;
        ws.oversample = '2x';
        return ws;
    }

    _chokeOpenHat(time) {
        if (this._openHat) {
            try {
                this._openHat.gain.gain.cancelScheduledValues(time);
                this._openHat.gain.gain.setTargetAtTime(0, time, 0.006);
            } catch (e) { /* node already finished */ }
            this._openHat = null;
        }
    }

    // ================================================================ 808 voices
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
        this._chokeOpenHat(time);
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

    // ================================================================ 909 voices
    _kick909(ctx, dest, time, vol, pf, accent) {
        // Faster pitch sweep, harder attack, a little soft clipping for punch
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const clip = this._softClip(ctx, accent ? 2.6 : 1.8);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(260 * pf, time);
        osc.frequency.exponentialRampToValueAtTime(58 * pf, time + 0.035);
        osc.frequency.exponentialRampToValueAtTime(50 * pf, time + 0.25);
        gain.gain.setValueAtTime(vol * 1.0, time);
        gain.gain.setValueAtTime(vol * 1.0, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, time + (accent ? 0.5 : 0.38));
        osc.connect(clip);
        clip.connect(gain);
        gain.connect(dest);
        osc.start(time);
        osc.stop(time + 0.55);

        // Clicky attack (bandpassed noise + a short high sine chirp)
        const click = this._noise(ctx, time, 0.03);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 3200;
        bp.Q.value = 0.8;
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(vol * 0.5, time);
        cg.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
        click.connect(bp);
        bp.connect(cg);
        cg.connect(dest);

        const chirp = ctx.createOscillator();
        const chg = ctx.createGain();
        chirp.type = 'triangle';
        chirp.frequency.setValueAtTime(900 * pf, time);
        chirp.frequency.exponentialRampToValueAtTime(120 * pf, time + 0.012);
        chg.gain.setValueAtTime(vol * 0.45, time);
        chg.gain.exponentialRampToValueAtTime(0.001, time + 0.015);
        chirp.connect(chg);
        chg.connect(dest);
        chirp.start(time);
        chirp.stop(time + 0.03);
    }

    _snare909(ctx, dest, time, vol, pf) {
        // Two detuned triangles for the shell, bright noise for the snap
        [[185, 0.55], [330, 0.35]].forEach(([f, g]) => {
            const osc = ctx.createOscillator();
            const og = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f * 1.3 * pf, time);
            osc.frequency.exponentialRampToValueAtTime(f * pf, time + 0.02);
            og.gain.setValueAtTime(vol * g, time);
            og.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
            osc.connect(og);
            og.connect(dest);
            osc.start(time);
            osc.stop(time + 0.12);
        });

        const noise = this._noise(ctx, time, 0.3);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1400;
        const peak = ctx.createBiquadFilter();
        peak.type = 'peaking';
        peak.frequency.value = 4500;
        peak.gain.value = 6;
        peak.Q.value = 1;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.9, time);
        ng.gain.exponentialRampToValueAtTime(vol * 0.3, time + 0.05);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.26);
        noise.connect(hp);
        hp.connect(peak);
        peak.connect(ng);
        ng.connect(dest);
    }

    _clap909(ctx, dest, time, vol) {
        const noise = this._noise(ctx, time, 0.5);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1150;
        bp.Q.value = 0.9;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 500;
        const gain = ctx.createGain();
        const g = gain.gain;
        g.setValueAtTime(0.0001, time);
        [0, 0.0095, 0.019, 0.0285].forEach(off => {
            g.setValueAtTime(vol * 0.95, time + off);
            g.exponentialRampToValueAtTime(vol * 0.2, time + off + 0.008);
        });
        g.setValueAtTime(vol * 1.0, time + 0.038);
        g.exponentialRampToValueAtTime(0.001, time + 0.42);
        noise.connect(bp);
        bp.connect(hp);
        hp.connect(gain);
        gain.connect(dest);
    }

    _hihat909(ctx, dest, time, vol, pf, open) {
        this._chokeOpenHat(time);
        const dur = open ? 0.32 : 0.055;
        // Noise body (the 909 hats were samples — bright filtered noise gets close)
        const noise = this._noise(ctx, time, dur);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 8800 * Math.min(1.3, Math.max(0.6, pf));
        const peak = ctx.createBiquadFilter();
        peak.type = 'peaking';
        peak.frequency.value = 11000;
        peak.gain.value = 5;
        peak.Q.value = 1.4;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol * (open ? 0.55 : 0.6), time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        noise.connect(hp);
        hp.connect(peak);
        peak.connect(gain);
        gain.connect(dest);

        // Thin metallic layer
        const metal = this._metal(ctx, time, dur, pf * 1.12);
        const mhp = ctx.createBiquadFilter();
        mhp.type = 'highpass';
        mhp.frequency.value = 9000;
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(vol * 0.18, time);
        mg.gain.exponentialRampToValueAtTime(0.001, time + dur);
        metal.connect(mhp);
        mhp.connect(mg);
        mg.connect(dest);

        if (open) this._openHat = { gain };
    }

    _tom909(ctx, dest, time, vol, freq) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const clip = this._softClip(ctx, 1.6);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 2.2, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.045);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.8, time + 0.3);
        gain.gain.setValueAtTime(vol * 0.95, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
        osc.connect(clip);
        clip.connect(gain);
        gain.connect(dest);
        osc.start(time);
        osc.stop(time + 0.35);

        const noise = this._noise(ctx, time, 0.08);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = freq * 6;
        bp.Q.value = 0.6;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.3, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
        noise.connect(bp);
        bp.connect(ng);
        ng.connect(dest);
    }

    _ride909(ctx, dest, time, vol, pf) {
        const dur = 1.5;
        const metal = this._metal(ctx, time, dur, pf * 1.35);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 5600;
        bp.Q.value = 0.6;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 3800;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol * 0.55, time);
        gain.gain.exponentialRampToValueAtTime(vol * 0.22, time + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        metal.connect(bp);
        bp.connect(hp);
        hp.connect(gain);
        gain.connect(dest);

        const noise = this._noise(ctx, time, 1.0);
        const nhp = ctx.createBiquadFilter();
        nhp.type = 'highpass';
        nhp.frequency.value = 7000;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.2, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 1.0);
        noise.connect(nhp);
        nhp.connect(ng);
        ng.connect(dest);
    }

    _rim909(ctx, dest, time, vol, pf) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2100 * pf, time);
        osc.frequency.exponentialRampToValueAtTime(900 * pf, time + 0.02);
        gain.gain.setValueAtTime(vol * 0.6, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(time);
        osc.stop(time + 0.05);

        const noise = this._noise(ctx, time, 0.04);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2500;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.5, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
        noise.connect(hp);
        hp.connect(ng);
        ng.connect(dest);
    }
}
