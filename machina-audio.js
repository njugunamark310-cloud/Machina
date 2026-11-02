
let ctx;
let master;
let engineGain;
let turboGain;
let exhaustGain;
let engineOsc;
let engineHarmonic;
let turboOsc;
let noiseSource;
let audioTimer = null;
let enabled = false;
let previousBoost = 0;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function createAudio() {
    if (ctx) return;

    ctx = new (window.AudioContext || window.webkitAudioContext)();

    master = ctx.createGain();
    master.gain.value = 0;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;

    master.connect(compressor);
    compressor.connect(ctx.destination);

    // Deep four-cylinder exhaust
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.7;
    engineGain.connect(master);

    engineOsc = ctx.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 27;

    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 420;

    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineOsc.start();

    engineHarmonic = ctx.createOscillator();
    engineHarmonic.type = "triangle";
    engineHarmonic.frequency.value = 54;

    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.3;
    engineHarmonic.connect(harmonicGain);
    harmonicGain.connect(engineGain);
    engineHarmonic.start();

    // Exhaust rumble and texture
    const buffer = ctx.createBuffer(
        1, ctx.sampleRate * 2, ctx.sampleRate
    );

    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    const exhaustFilter = ctx.createBiquadFilter();
    exhaustFilter.type = "lowpass";
    exhaustFilter.frequency.value = 650;

    exhaustGain = ctx.createGain();
    exhaustGain.gain.value = 0.12;

    noiseSource.connect(exhaustFilter);
    exhaustFilter.connect(exhaustGain);
    exhaustGain.connect(master);
    noiseSource.start();

    // Turbo whistle
    turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboGain.connect(master);

    turboOsc = ctx.createOscillator();
    turboOsc.type = "sine";
    turboOsc.frequency.value = 1200;

    const turboFilter = ctx.createBiquadFilter();
    turboFilter.type = "bandpass";
    turboFilter.frequency.value = 3000;
    turboFilter.Q.value = 1;

    turboOsc.connect(turboFilter);
    turboFilter.connect(turboGain);
    turboOsc.start();
}

function blowOff() {
    if (!ctx || !enabled) return;

    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    const buffer = ctx.createBuffer(
        1, ctx.sampleRate, ctx.sampleRate
    );

    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(4500, now);
    filter.frequency.exponentialRampToValueAtTime(800, now + 0.5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.4, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    source.start(now);
    source.stop(now + 0.65);

    window.dispatchEvent(new CustomEvent("machina-bov"));
}

function updateAudio() {
    if (!enabled || !ctx) return;

    const engine = window.machina?.engine;
    if (!engine) return;

    const running = engine.running;
    const rpm = running
        ? clamp(Number(engine.rpm) || 800, 800, 7000)
        : 0;

    const boost = running
        ? clamp(Number(engine.boost) || 0, 0, 2)
        : 0;

    const load = running
        ? clamp(Number(engine.load) || 0.5, 0, 1)
        : 0;

    const now = ctx.currentTime;
    const rpmRatio = rpm / 7000;

    // Engine firing frequency: four-cylinder, four-stroke.
    const firingFrequency = rpm / 30;

    engineOsc.frequency.setTargetAtTime(
        firingFrequency, now, 0.04
    );

    engineHarmonic.frequency.setTargetAtTime(
        firingFrequency * 2, now, 0.04
    );

    engineGain.gain.setTargetAtTime(
        running ? 0.32 + rpmRatio * 0.42 + load * 0.15 : 0,
        now, 0.06
    );

    exhaustGain.gain.setTargetAtTime(
        running ? 0.07 + load * 0.16 : 0,
        now, 0.08
    );

    // Turbo whistle rises with RPM and boost.
    turboOsc.frequency.setTargetAtTime(
        1000 + rpmRatio * 2800 + boost * 1300,
        now, 0.1
    );

    turboGain.gain.setTargetAtTime(
        running ? boost * 0.13 : 0,
        now, 0.1
    );

    // Blow-off when boost suddenly drops.
    if (
        previousBoost > 0.8 &&
        previousBoost - boost > 0.4 &&
        running
    ) {
        blowOff();
    }

    previousBoost = boost;
}

function startAudio() {
    createAudio();

    return ctx.resume().then(() => {
        enabled = true;

        master.gain.setTargetAtTime(
            0.85, ctx.currentTime, 0.08
        );

        if (audioTimer) clearInterval(audioTimer);

        updateAudio();
        audioTimer = setInterval(updateAudio, 30);
    });
}

function stopAudio() {
    enabled = false;
    previousBoost = 0;

    if (audioTimer) {
        clearInterval(audioTimer);
        audioTimer = null;
    }

    if (ctx && master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(
            0, ctx.currentTime, 0.025
        );
    }
}

export const machinaAudio = {
    bindButton(button) {
        if (!button) {
            console.error("MACHINA: Sound button #toggle-sound not found.");
            return;
        }

        button.textContent = "SOUND: OFF";
        button.classList.remove("active");

        button.addEventListener("click", async () => {
            if (enabled) {
                stopAudio();
                button.textContent = "SOUND: OFF";
                button.classList.remove("active");
                return;
            }

            button.disabled = true;

            try {
                await startAudio();

                button.textContent = "SOUND: ON";
                button.classList.add("active");
            } catch (error) {
                console.error("MACHINA audio error:", error);
                stopAudio();
                button.textContent = "SOUND: ERROR";
            } finally {
                button.disabled = false;
            }
        });
    }
};
