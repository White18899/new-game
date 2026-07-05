class SoundManager {
  constructor() {
    this.ctx = null;
    this.isMuted = true;
    this.bgmOscs = null;
    this.bgmTimeout = null;
  }

  init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
  }

  toggleMute() {
    this.init();
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopBGM();
    } else {
      this.startBGM();
    }
    return this.isMuted;
  }

  playThrow() {
    this.init();
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    // Whoosh filter noise
    const bufferSize = this.ctx.sampleRate * 0.15; // 150ms
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 0.15);
    filter.Q.setValueAtTime(3, now);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    noise.start(now);
  }

  playDraw() {
    this.init();
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    // Soft double tick
    const playTick = (time) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, time);
      osc.frequency.exponentialRampToValueAtTime(200, time + 0.05);
      
      gain.gain.setValueAtTime(0.15, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
    };
    
    playTick(now);
    playTick(now + 0.06);
  }

  playTurnAlert() {
    this.init();
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Friendly clean ding-dong chime
    const playChime = (freq, time, dur) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);
      
      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    };
    
    playChime(660, now, 0.15); // E5
    playChime(880, now + 0.12, 0.3); // A5
  }

  playUnoFanfare() {
    this.init();
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Fanfare chord: C5 - E5 - G5 - C6
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      
      gain.gain.setValueAtTime(0.06, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.4);
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.5);
    });
  }

  playChatNotification() {
    this.init();
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    // Quick synth chime
    const playChime = (freq, time, dur) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      
      gain.gain.setValueAtTime(0.08, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    };
    
    playChime(523.25, now, 0.1); // C5
    playChime(659.25, now + 0.08, 0.15); // E5
  }

  startBGM() {
    this.stopBGM();
    this.init();
    if (this.isMuted || !this.ctx) return;
    
    // Loops a gentle 4-chord pad progression: Cmaj7 - Am7 - Fmaj7 - G6
    const chords = [
      [130.81, 261.63, 329.63, 392.00, 493.88], // Cmaj7
      [110.00, 220.00, 261.63, 329.63, 392.00], // Am7
      [87.31, 174.61, 261.63, 349.23, 440.00],  // Fmaj7
      [98.00, 196.00, 293.66, 392.00, 440.00]   // G6
    ];
    
    let chordIdx = 0;
    const chordDuration = 5.0; // 5 seconds per chord
    
    const playNextChord = () => {
      if (this.isMuted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const freqs = chords[chordIdx];
      
      this.bgmOscs = freqs.map(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        
        // Gentle swell in and fade out
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.04, t + 1.5);
        gain.gain.setValueAtTime(0.04, t + chordDuration - 1.5);
        gain.gain.linearRampToValueAtTime(0, t + chordDuration);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(t);
        osc.stop(t + chordDuration);
        return osc;
      });
      
      chordIdx = (chordIdx + 1) % chords.length;
      this.bgmTimeout = setTimeout(playNextChord, chordDuration * 1000 - 50);
    };
    
    playNextChord();
  }

  stopBGM() {
    if (this.bgmTimeout) {
      clearTimeout(this.bgmTimeout);
      this.bgmTimeout = null;
    }
    if (this.bgmOscs) {
      this.bgmOscs.forEach(osc => {
        try { osc.stop(); } catch(e) {}
      });
      this.bgmOscs = null;
    }
  }
}

// Instantiate globally
window.gameSound = new SoundManager();
