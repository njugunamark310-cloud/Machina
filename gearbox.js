import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ================= Gearbox simulation (physics) =================
// MACHINA Gearbox Lab: simulation core (no Three.js, no DOM).
// Kept separate so the AWD, air-suspension and hybrid modules can reuse it,
// and so it can be unit-tested in Node.

const MODULE = 0.015;               // pitch radius per tooth (scene units)
const AXIS_Y = { main: 0.45, counter: -0.45 };
const CENTER_DISTANCE = AXIS_Y.main - AXIS_Y.counter; // 0.9 = 60 teeth * MODULE

const pitchRadius = (teeth) => teeth * MODULE;

// Constant-mesh layout: input shaft and output shaft are coaxial (top),
// the countershaft is below. Forward pairs always total 60 teeth so they mesh.
const INPUT_PAIR = { input: 24, counter: 36 };

const GEARS = [
    { gear: -1, label: "R", main: 32, counter: 18, x: -1.05 },
    { gear: 1, label: "1", main: 42, counter: 18, x: -0.77 },
    { gear: 2, label: "2", main: 36, counter: 24, x: -0.49 },
    { gear: 3, label: "3", main: 30, counter: 30, x: -0.21 },
    { gear: 4, label: "4", main: 27, counter: 33, x: 0.07 },
    { gear: 5, label: "5", main: 24, counter: 36, x: 0.35 },
    { gear: 6, label: "6", main: 21, counter: 39, x: 0.63 }
];

// Reverse needs an idler gear so the output turns the other way.
function idlerPosition(mainTeeth, counterTeeth, idlerTeeth) {
    const dm = (mainTeeth + idlerTeeth) * MODULE;
    const dc = (counterTeeth + idlerTeeth) * MODULE;
    const D = CENTER_DISTANCE;
    const a = (dc * dc - dm * dm + D * D) / (2 * D);
    return { y: AXIS_Y.counter + a, z: Math.sqrt(dc * dc - a * a) };
}

const REV = GEARS[0];
const REVERSE_IDLER = {
    teeth: 24,
    x: REV.x,
    ...idlerPosition(REV.main, REV.counter, 24)
};

// Synchro sleeves: [x position, gears it selects as [negative stroke, positive stroke]]
const SLEEVES = [
    { x: -0.91, name: "R", gears: [-1, null] },
    { x: -0.63, name: "1/2", gears: [1, 2] },
    { x: -0.07, name: "3/4", gears: [3, 4] },
    { x: 0.49, name: "5/6", gears: [5, 6] }
];
const SLEEVE_STROKE = 0.14;

const FINAL_DRIVE = 4.1;
const WHEEL_RADIUS = 0.33;
const IDLE_RPM = 850;
const REDLINE = 7000;
const MASS = 1600;
const ROLLING_N = 171;
const DRAG_K = 0.409;
const BRAKE_N = 14000;
const CLUTCH_CAPACITY = 400;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const approach = (current, target, rate, dt) =>
    current + (target - current) * (1 - Math.exp(-rate * dt));

const GEAR_LABEL = (g) => (g === -1 ? "R" : g === 0 ? "N" : String(g));

// Overall ratio magnitude between engine and the output shaft (not incl. final drive)
function gearRatio(gear) {
    if (gear === 0) return 0;
    const g = GEARS.find((entry) => entry.gear === gear);
    return (INPUT_PAIR.counter / INPUT_PAIR.input) * (g.main / g.counter);
}

function ordinal(g) {
    return g === 1 ? "1st" : g === 2 ? "2nd" : g === 3 ? "3rd" : `${g}th`;
}

// ---- Engine torque (illustrative turbo four) -------------------------------
const TORQUE_POINTS = [
    [0, 80], [800, 110], [1500, 170], [2500, 230],
    [4500, 250], [6000, 225], [7000, 170], [9000, 100]
];

function torqueCurve(rpm) {
    for (let i = 1; i < TORQUE_POINTS.length; i++) {
        const [r1, t1] = TORQUE_POINTS[i];
        if (rpm <= r1) {
            const [r0, t0] = TORQUE_POINTS[i - 1];
            return t0 + ((rpm - r0) / (r1 - r0)) * (t1 - t0);
        }
    }
    return TORQUE_POINTS[TORQUE_POINTS.length - 1][1];
}

// ---- Gear-mesh geometry -----------------------------------------------------
// Angle of a gear B that meshes with gear A. phi = direction from A's centre to
// B's centre (in the gears' own plane). Keeps teeth interleaved at all times.
function meshPartner(thetaA, teethA, teethB, phi) {
    return -(teethA / teethB) * (thetaA - phi) + phi + Math.PI - Math.PI / teethB;
}

const wrapCentered = (x, period) =>
    ((((x + period / 2) % period) + period) % period) - period / 2;

// 0 when the teeth are perfectly interleaved. Used by tests.
function meshError(thetaA, teethA, thetaB, teethB, phi) {
    const rA = teethA * MODULE;
    const rB = teethB * MODULE;
    const deltaA = wrapCentered(phi - thetaA, (2 * Math.PI) / teethA);
    const deltaB = wrapCentered(phi + Math.PI - thetaB - Math.PI / teethB, (2 * Math.PI) / teethB);
    const sA = -rA * deltaA;
    const sB = -rB * deltaB;
    return wrapCentered(sA + sB, 2 * Math.PI * MODULE);
}

// Local gear-plane coords are (-worldZ, worldY).
const dirAngle = (from, to) => Math.atan2(to.y - from.y, -(to.z - from.z));

const COUNTER_POS = { y: AXIS_Y.counter, z: 0 };
const MAIN_POS = { y: AXIS_Y.main, z: 0 };
const PHI = {
    inputToCounter: -Math.PI / 2,
    counterToMain: Math.PI / 2,
    counterToIdler: dirAngle(COUNTER_POS, REVERSE_IDLER),
    idlerToMain: dirAngle(REVERSE_IDLER, MAIN_POS)
};

// Everything downstream of the input gear angle is geometry, so every pair meshes.
function computeGearAngles(thetaIn) {
    const counter = meshPartner(thetaIn, INPUT_PAIR.input, INPUT_PAIR.counter, PHI.inputToCounter);
    const mains = {};

    for (const g of GEARS) {
        if (g.gear > 0) mains[g.gear] = meshPartner(counter, g.counter, g.main, PHI.counterToMain);
    }

    const idler = meshPartner(counter, REV.counter, REVERSE_IDLER.teeth, PHI.counterToIdler);
    mains[-1] = meshPartner(idler, REVERSE_IDLER.teeth, REV.main, PHI.idlerToMain);

    return { counter, idler, mains };
}

// ---- Drivetrain state -------------------------------------------------------
function createDrivetrain() {
    return {
        gear: 0,            // gear actually locked in by a sleeve
        targetGear: 0,      // gear the shifter is moving to
        sleeves: [0, 0, 0, 0],
        sleeveVel: [0, 0, 0, 0],
        speed: 0,           // m/s, signed
        rpm: IDLE_RPM,
        rpmFree: IDLE_RPM,
        pedal: 0,
        throttle: 0,
        brake: 0,
        running: true,
        coupling: 1,        // 0 = clutch fully open, 1 = fully locked
        inputRpm: 0,
        outputRpm: 0,       // signed, output shaft
        engineTorque: 0,
        wheelTorque: 0,
        speedKmh: 0,
        overRev: false,
        message: "",
        messageTimer: 0
    };
}

function sleeveTargetFor(gear) {
    for (let i = 0; i < SLEEVES.length; i++) {
        const idx = SLEEVES[i].gears.indexOf(gear);
        if (gear !== 0 && idx !== -1) return { sleeve: i, offset: idx === 0 ? -SLEEVE_STROKE : SLEEVE_STROKE };
    }
    return null;
}

function engagedGear(sleeves) {
    for (let i = 0; i < SLEEVES.length; i++) {
        const o = sleeves[i];
        if (Math.abs(o) >= SLEEVE_STROKE * 0.9) {
            const g = SLEEVES[i].gears[o < 0 ? 0 : 1];
            if (g !== null) return g;
        }
    }
    return 0;
}

function requestGear(s, gear) {
    if (gear === s.targetGear) return { ok: true };

    // Selecting a gear while the clutch is engaged would grind the dogs.
    if (gear !== 0 && s.pedal < 0.75) {
        s.message = "GEAR GRIND: PRESS THE CLUTCH FIRST";
        s.messageTimer = 2.2;
        return { ok: false, reason: "clutch" };
    }

    s.targetGear = gear;
    return { ok: true };
}

// Spring-loaded sleeves: a stiff, slightly under-damped spring gives a quick
// stroke (~60 ms) with a tiny overshoot, which reads as a crisp "click".
const SLEEVE_K = 2600;   // spring stiffness
const SLEEVE_C = 62;     // damping

function updateSleeves(s, dt) {
    const wanted = sleeveTargetFor(s.targetGear);
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / steps;

    for (let i = 0; i < SLEEVES.length; i++) {
        let target = 0;

        if (wanted && wanted.sleeve === i) {
            // Only start engaging once every other sleeve is back in neutral.
            const othersClear = s.sleeves.every((o, j) => j === i || Math.abs(o) < 0.02);
            if (othersClear) target = wanted.offset;
        }

        for (let k = 0; k < steps; k++) {
            const acc = SLEEVE_K * (target - s.sleeves[i]) - SLEEVE_C * s.sleeveVel[i];
            s.sleeveVel[i] += acc * h;
            s.sleeves[i] += s.sleeveVel[i] * h;
        }

        if (Math.abs(s.sleeves[i] - target) < 0.0015 && Math.abs(s.sleeveVel[i]) < 0.05) {
            s.sleeves[i] = target;
            s.sleeveVel[i] = 0;
        }
    }
}

function stepDrivetrain(s, dt, ctrl) {
    // ctrl.running = false means the engine is off: no torque, and the crank only
    // turns if the wheels drag it round through an engaged gear.
    const running = ctrl.running !== false;
    const idle = running ? IDLE_RPM : 0;
    s.running = running;
    s.throttle = running ? clamp(ctrl.throttle, 0, 1) : 0;
    s.pedal = clamp(ctrl.pedal, 0, 1);
    s.brake = clamp(ctrl.brake, 0, 1);

    if (s.messageTimer > 0) {
        s.messageTimer -= dt;
        if (s.messageTimer <= 0) s.message = "";
    }

    updateSleeves(s, dt);
    s.gear = engagedGear(s.sleeves);

    // Clutch bite curve: fully locked up to 25% pedal, fully open at 75%.
    const x = clamp(1 - (s.pedal - 0.25) / 0.5, 0, 1);
    s.coupling = x * x * (3 - 2 * x);

    const engaged = s.gear !== 0;
    const dir = s.gear < 0 ? -1 : 1;
    const overall = gearRatio(s.gear) * FINAL_DRIVE;
    const wheelRpm = (s.speed / (2 * Math.PI * WHEEL_RADIUS)) * 60;

    // The wheels drive the engine through the gears when the clutch is closed.
    const rollingWithGear = engaged && s.speed * dir > -0.3;
    const coupledRpm = rollingWithGear
        ? Math.max(idle, Math.abs(wheelRpm) * overall)
        : idle;
    const eff = engaged ? s.coupling : 0;

    const freeTarget = running ? IDLE_RPM + s.throttle * (REDLINE - 100 - IDLE_RPM) : 0;
    s.rpmFree = approach(s.rpmFree, freeTarget, 6, dt);
    if (eff > 0.999) s.rpmFree = coupledRpm;

    s.rpm = clamp(s.rpmFree * (1 - eff) + coupledRpm * eff, idle, 9000);
    s.overRev = s.rpm > REDLINE + 150;

    // Engine torque, with a rev limiter and pumping friction when off the throttle.
    const limiter = s.rpm >= REDLINE ? 0 : 1;
    const friction = s.rpm > 1 ? 12 + s.rpm * 0.012 : 0;
    const engineTorque = s.throttle * torqueCurve(s.rpm) * limiter - friction * (1 - s.throttle);
    s.engineTorque = engineTorque;

    let transmitted = clamp(engineTorque, -CLUTCH_CAPACITY * eff, CLUTCH_CAPACITY * eff);
    const engineBraking = engaged && s.speed * dir > 0.3;
    if (!engineBraking) transmitted = Math.max(transmitted, 0);

    const driveForce = engaged
        ? (dir * transmitted * overall * 0.92) / WHEEL_RADIUS
        : 0;

    // Vehicle motion
    const v = s.speed;
    const brakeForce = s.brake * BRAKE_N;

    if (Math.abs(v) < 0.05 && Math.abs(driveForce) <= ROLLING_N + brakeForce) {
        s.speed = 0;
    } else {
        const sign = v !== 0 ? Math.sign(v) : Math.sign(driveForce || 1);
        const resist = ROLLING_N + DRAG_K * v * v + brakeForce;
        const next = v + ((driveForce - sign * resist) / MASS) * dt;

        s.speed = v !== 0 && Math.sign(next) !== Math.sign(v) && Math.abs(driveForce) < resist
            ? 0
            : next;
    }

    s.wheelTorque = driveForce * WHEEL_RADIUS;
    s.speedKmh = s.speed * 3.6;
    s.outputRpm = (s.speed / (2 * Math.PI * WHEEL_RADIUS)) * 60 * FINAL_DRIVE;

    // Input shaft: forced by the wheels when a gear is locked, else follows the clutch disc.
    const inputTarget = engaged
        ? Math.abs(s.outputRpm) * gearRatio(s.gear)
        : s.rpm * s.coupling;
    s.inputRpm = approach(s.inputRpm, inputTarget, 15, dt);

    return s;
}

// ---- Driver aid: automatic clutch + gear selection --------------------------
function createAuto() {
    return { phase: "run", pedal: 0, want: 0, from: 0, timer: 0, t: 0, demo: false };
}

function autoDrive(s, a, user, dt) {
    a.t += dt;
    let throttle = user.throttle;
    let brake = user.brake;

    if (a.demo) {
        const c = a.t % 36;
        if (c < 20) { throttle = 0.9; brake = 0; }
        else if (c < 30) { throttle = 0; brake = c < 24 ? 0.15 : 0.55; }
        else { throttle = 0; brake = 0.7; }
    }

    const speed = Math.abs(s.speed);
    const g = s.targetGear;

    if (a.phase === "run") {
        a.pedal = 0;
        let want = g;

        if (g === 0) {
            if (throttle > 0.05) want = 1;
        } else if (g > 0) {
            if (speed < 0.5 && throttle < 0.02) want = 0;
            else if (s.rpm > 6100 && g < 6 && throttle > 0.3) want = g + 1;
            else if (s.rpm < 1700 && g > 1 && speed > 1) want = g - 1;
        }

        if (want !== g) {
            a.phase = "dip";
            a.want = want;
            a.from = g;
            a.timer = 0;
        }
    } else if (a.phase === "dip") {
        a.pedal = Math.min(1, a.pedal + dt * 16);
        if (a.pedal >= 0.85) {
            requestGear(s, a.want);
            a.phase = "wait";
            a.timer = 0;
        }
    } else if (a.phase === "wait") {
        a.pedal = 1;
        a.timer += dt;
        if (s.gear === a.want || a.timer > 0.7) a.phase = "rise";
    } else if (a.phase === "rise") {
        const launch = a.want === 1 || a.want === -1;
        a.pedal = Math.max(0, a.pedal - dt * (launch ? 2.0 : 9));
        if (a.want === 0 || a.pedal <= 0.02) {
            a.pedal = 0;
            a.phase = "run";
        }
    }

    // Shift technique: lift off the throttle on upshifts, blip it on downshifts.
    if (a.phase === "dip" || a.phase === "wait") {
        if (a.want > a.from && a.from > 0) throttle = 0;
        else if (a.want < a.from && a.want > 0) throttle = Math.max(throttle, 0.6);
    }
    if (a.phase === "rise" && a.want < a.from && a.want > 0 && a.pedal > 0.2) {
        throttle = Math.max(throttle, 0.5);
    }

    return { throttle, brake, pedal: Math.max(a.pedal, user.pedal) };
}

// ================= Gearbox 3D view and controls =================

const COLORS = { background: "#05080f", cyan: "#00e5ff", orange: "#ff8a00" };
const SLOW_MOTION = 40;
const RAD_PER_RPM_SEC = (2 * Math.PI) / 60 / SLOW_MOTION;
const FLOOR_Y = -1.45;
const REV_GEAR = GEARS[0];

const $ = (selector) => document.querySelector(selector);
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const container = $("#gearbox-canvas");

if (container) init(container);
else console.warn("Gearbox viewer container (#gearbox-canvas) was not found.");

function init(container) {
    const ui = {
        reset: $("#gb-reset"), housing: $("#gb-housing"), auto: $("#gb-auto"), demo: $("#gb-demo"),
        throttle: $("#gb-throttle"), clutch: $("#gb-clutch"), brake: $("#gb-brake"),
        gear: $("#gb-gear"), rpm: $("#gb-rpm"), speed: $("#gb-speed"), ratio: $("#gb-ratio"),
        input: $("#gb-input"), output: $("#gb-output"), torque: $("#gb-torque"),
        couplingBar: $("#gb-coupling-bar"), rpmBar: $("#gb-rpm-bar"), message: $("#gb-message"),
        gearButtons: [...document.querySelectorAll("[data-gear]")],
        partName: $("#gb-part-name"), partDesc: $("#gb-part-desc"),
        partMaterial: $("#gb-part-material"), partFunction: $("#gb-part-function"),
        section: $("#gearbox-lab")
    };

    // ---- Renderer / scene -----------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.background);
    scene.fog = new THREE.Fog(COLORS.background, 10, 26);

    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 100);
    const cameraStart = new THREE.Vector3(2.6, 2.2, 5.6);
    const targetStart = new THREE.Vector3(-0.5, 0.05, 0);
    camera.position.copy(cameraStart);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "Interactive 3D simulation of a six-speed manual gearbox");
    renderer.domElement.style.touchAction = "none";
    container.querySelector(".engine-loading, .gb-loading")?.remove();
    container.appendChild(renderer.domElement);

    // Bloom makes the emissive power path, sleeve flashes and hologram lines glow.
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
        Math.max(1, container.clientWidth),
        Math.max(1, container.clientHeight),
        { type: THREE.HalfFloatType, samples: 4 }
    ));
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(
        new THREE.Vector2(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight)),
        0.65, 0.7, 0.8
    ));
    composer.addPass(new OutputPass());

    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = new RoomEnvironment();
    scene.environment = pmrem.fromScene(studio, 0.04).texture;
    scene.environmentIntensity = 0.6;
    studio.dispose?.();
    pmrem.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.target.copy(targetStart);

    scene.add(new THREE.HemisphereLight("#7fdcff", "#1a0f05", 0.5));
    const key = new THREE.DirectionalLight("#ffffff", 2.2);
    key.position.set(3, 5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 16 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const cyanLight = new THREE.PointLight(COLORS.cyan, 18, 10);
    cyanLight.position.set(-4, 1, 2);
    scene.add(cyanLight);
    const orangeLight = new THREE.PointLight(COLORS.orange, 12, 10);
    orangeLight.position.set(3, -1, -2);
    scene.add(orangeLight);

    const floor = new THREE.Group();
    floor.position.y = FLOOR_Y;
    const grid = new THREE.GridHelper(24, 48, COLORS.cyan, "#12384f");
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    floor.add(grid);
    const shadowCatcher = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2),
        new THREE.ShadowMaterial({ color: 0x000814, opacity: 0.55 })
    );
    shadowCatcher.position.y = 0.002;
    shadowCatcher.receiveShadow = true;
    floor.add(shadowCatcher);
    scene.add(floor);

    // ---- Materials -------------------------------------------------------------
    const metal = (color, extra = {}) =>
        new THREE.MeshPhysicalMaterial({
            color, metalness: 0.88, roughness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.35,
            emissive: "#000000", ...extra
        });

    const shaftMat = metal("#aab7c4", { roughness: 0.28 });
    const inputShaftMat = metal("#48c9d8", { roughness: 0.3 });
    const hubMat = metal("#6f8196");
    const sleeveMat = metal("#d7e6f5", { roughness: 0.22 });
    const forkMat = metal("#e87532", { metalness: 0.7, roughness: 0.3 });
    const railMat = metal("#c4ccd3", { roughness: 0.2 });
    const markMat = new THREE.MeshStandardMaterial({ color: COLORS.orange, emissive: COLORS.orange, emissiveIntensity: 2.5 });

    const gearColors = { main: "#5b7088", counter: "#4a5d72", input: "#2b8fa3", idler: "#9a6a44" };

    // ---- Gear geometry ----------------------------------------------------------
    const GEAR_WIDTH = 0.1;
    const gearGeometryCache = new Map();

    function gearGeometry(teeth) {
        if (gearGeometryCache.has(teeth)) return gearGeometryCache.get(teeth);

        const pitch = teeth * MODULE;
        const root = pitch - 0.016;
        const tip = pitch + 0.012;
        const step = (Math.PI * 2) / teeth;
        const shape = new THREE.Shape();

        const addPoint = (angle, radius, first) => {
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (first) shape.moveTo(x, y);
            else shape.lineTo(x, y);
        };

        for (let k = 0; k < teeth; k++) {
            const a = k * step;
            addPoint(a - 0.3 * step, root, k === 0);
            addPoint(a - 0.15 * step, tip, false);
            addPoint(a + 0.15 * step, tip, false);
            addPoint(a + 0.3 * step, root, false);
        }
        shape.closePath();

        const bore = new THREE.Path();
        bore.absarc(0, 0, 0.078, 0, Math.PI * 2, true);
        shape.holes.push(bore);

        if (pitch > 0.42) {
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const hole = new THREE.Path();
                hole.absarc(Math.cos(a) * pitch * 0.58, Math.sin(a) * pitch * 0.58, pitch * 0.2, 0, Math.PI * 2, true);
                shape.holes.push(hole);
            }
        }

        const geometry = new THREE.ExtrudeGeometry(shape, { depth: GEAR_WIDTH, bevelEnabled: false, curveSegments: 8 });
        geometry.translate(0, 0, -GEAR_WIDTH / 2);
        gearGeometryCache.set(teeth, geometry);
        return geometry;
    }

    // Gear axes run along world X: the pivot turns local Z into world X, so a
    // rotation about local Z is a rotation about the shaft.
    function makeGear(teeth, color, position, partKey) {
        const mesh = new THREE.Mesh(gearGeometry(teeth), metal(color));
        mesh.userData.partKey = partKey;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const pivot = new THREE.Group();
        pivot.rotation.y = Math.PI / 2;
        pivot.position.copy(position);
        pivot.add(mesh);
        return { pivot, mesh };
    }

    const pickables = [];
    const addPick = (mesh, key) => { mesh.userData.partKey = key; pickables.push(mesh); return mesh; };
    const cylinderAlongX = (r1, r2, length, material, key) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, length, 28).rotateZ(Math.PI / 2), material);
        mesh.castShadow = true;
        if (key) addPick(mesh, key);
        return mesh;
    };

    const root = new THREE.Group();
    scene.add(root);

    // ---- Shafts ------------------------------------------------------------------
    const flywheelGroup = new THREE.Group();
    flywheelGroup.position.set(-2.5, AXIS_Y.main, 0);
    const flywheel = cylinderAlongX(0.62, 0.62, 0.14, metal("#7c8a98", { roughness: 0.3 }), "flywheel");
    flywheelGroup.add(flywheel);
    const flywheelMark = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.04), markMat);
    flywheelMark.position.set(0.075, 0.5, 0);
    flywheelGroup.add(flywheelMark);
    root.add(flywheelGroup);

    const inputGroup = new THREE.Group();
    inputGroup.position.set(0, AXIS_Y.main, 0);
    const inputShaft = cylinderAlongX(0.065, 0.065, 1.2, inputShaftMat, "input-shaft");
    inputShaft.position.x = -1.9;
    inputGroup.add(inputShaft);
    const clutchDisc = cylinderAlongX(0.5, 0.5, 0.05, metal("#8a5a3a", { metalness: 0.3, roughness: 0.7 }), "clutch-disc");
    clutchDisc.position.x = -2.36;
    inputGroup.add(clutchDisc);
    const clutchMark = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.04), markMat);
    clutchMark.position.set(-2.36, 0.4, 0);
    inputGroup.add(clutchMark);
    const inputMark = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), markMat);
    inputMark.position.set(-1.65, 0.07, 0);
    inputGroup.add(inputMark);
    root.add(inputGroup);

    const pressurePlate = cylinderAlongX(0.52, 0.52, 0.07, metal("#9aabbc", { roughness: 0.3 }), "pressure-plate");
    pressurePlate.position.set(-2.26, AXIS_Y.main, 0);
    root.add(pressurePlate);

    const outputGroup = new THREE.Group();
    outputGroup.position.set(0, AXIS_Y.main, 0);
    const outputShaft = cylinderAlongX(0.06, 0.06, 2.75, shaftMat, "output-shaft");
    outputShaft.position.x = 0.075;
    outputGroup.add(outputShaft);
    const outputMark = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), markMat);
    outputMark.position.set(1.0, 0.065, 0);
    outputGroup.add(outputMark);

    const flange = cylinderAlongX(0.28, 0.28, 0.08, metal("#8c9ba8", { roughness: 0.3 }), "flange");
    flange.position.x = 1.5;
    outputGroup.add(flange);
    const flangeMark = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), markMat);
    flangeMark.position.set(1.55, 0.2, 0);
    outputGroup.add(flangeMark);

    const sleeveMeshes = [];
    SLEEVES.forEach((def, i) => {
        const hub = cylinderAlongX(0.115, 0.115, 0.1, hubMat);
        hub.position.x = def.x;
        outputGroup.add(hub);

        const sleeve = cylinderAlongX(0.16, 0.16, 0.1, metal("#d7e6f5", { roughness: 0.22 }), `sleeve-${i}`);
        sleeve.position.x = def.x;
        const groove = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 8, 32).rotateY(Math.PI / 2), hubMat);
        sleeve.add(groove);
        outputGroup.add(sleeve);
        sleeveMeshes.push(sleeve);
    });
    root.add(outputGroup);

    const counterGroup = new THREE.Group();
    counterGroup.position.set(0, AXIS_Y.counter, 0);
    const counterShaft = cylinderAlongX(0.07, 0.07, 2.45, metal("#8c9ba8", { roughness: 0.3 }), "countershaft");
    counterShaft.position.x = -0.375;
    counterGroup.add(counterShaft);
    const counterMark = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), markMat);
    counterMark.position.set(0.75, 0.075, 0);
    counterGroup.add(counterMark);
    root.add(counterGroup);

    // ---- Gears ---------------------------------------------------------------------
    const gearParts = { mains: {}, counters: {}, input: null, counterInput: null, idler: null };

    // input pair
    {
        const input = makeGear(INPUT_PAIR.input, gearColors.input, new THREE.Vector3(-1.45, AXIS_Y.main, 0), "input-gear");
        pickables.push(input.mesh);
        root.add(input.pivot);
        gearParts.input = input;

        const counterInput = makeGear(INPUT_PAIR.counter, gearColors.input, new THREE.Vector3(-1.45, 0, 0), "counter-input-gear");
        pickables.push(counterInput.mesh);
        counterGroup.add(counterInput.pivot);
        gearParts.counterInput = counterInput;
    }

    for (const g of GEARS) {
        const main = makeGear(g.main, gearColors.main, new THREE.Vector3(g.x, AXIS_Y.main, 0), `main-${g.gear}`);
        pickables.push(main.mesh);
        root.add(main.pivot);
        gearParts.mains[g.gear] = main;

        // counter gears are fixed to the countershaft, so they ride inside its group
        const counter = makeGear(g.counter, gearColors.counter, new THREE.Vector3(g.x, 0, 0), `counter-${g.gear}`);
        pickables.push(counter.mesh);
        counterGroup.add(counter.pivot);
        gearParts.counters[g.gear] = counter;
    }

    {
        const idler = makeGear(
            REVERSE_IDLER.teeth, gearColors.idler,
            new THREE.Vector3(REVERSE_IDLER.x, REVERSE_IDLER.y, REVERSE_IDLER.z), "idler"
        );
        pickables.push(idler.mesh);
        root.add(idler.pivot);
        gearParts.idler = idler;

        const pin = cylinderAlongX(0.035, 0.035, 0.3, shaftMat, "idler");
        pin.position.set(REVERSE_IDLER.x, REVERSE_IDLER.y, REVERSE_IDLER.z);
        root.add(pin);
    }

    // ---- Shift forks and rails --------------------------------------------------------
    const forks = SLEEVES.map((def, i) => {
        const group = new THREE.Group();
        const railZ = i % 2 === 0 ? -0.15 : 0.15;
        const railY = 1.12;

        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.02, 8, 24, Math.PI).rotateY(Math.PI / 2), forkMat);
        arc.position.y = AXIS_Y.main;
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.035, railY - AXIS_Y.main - 0.19, 0.035), forkMat);
        stem.position.y = (railY + AXIS_Y.main + 0.19) / 2;
        const link = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, Math.abs(railZ)), forkMat);
        link.position.set(0, railY, railZ / 2);
        const collar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), forkMat);
        collar.position.set(0, railY, railZ);
        group.add(arc, stem, link, collar);
        group.position.x = def.x;
        group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
        addPick(arc, "fork");
        root.add(group);

        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 12).rotateZ(Math.PI / 2), railMat);
        rail.position.set(def.x, railY, railZ);
        root.add(rail);
        return group;
    });

    // ---- Shifter (H-gate) + sleeve flash state -----------------------------------------
    let shifter = null;
    import("./machina-shifter.js")
        .then(({ createShifter }) => {
            shifter = createShifter();
            shifter.group.position.set(-0.32, 1.36, 0);
            root.add(shifter.group);
        })
        .catch((error) => console.warn("MACHINA shifter module failed to load:", error));

    const sleeveFlash = SLEEVES.map(() => 0);
    let lastGear = 0;

    // Optional button; the floating sound dock exists on every section regardless.
    import("./machina-audio.js")
        .then(({ machinaAudio }) => machinaAudio.bindButton($("#gb-sound")))
        .catch((error) => console.warn("MACHINA audio module failed to load:", error));

    // ---- Housing -------------------------------------------------------------------------
    const housingSize = [2.95, 2.4, 1.75];
    const housing = new THREE.Group();
    housing.position.set(-0.32, 0, 0);
    housing.add(new THREE.Mesh(
        new RoundedBoxGeometry(...housingSize, 3, 0.06),
        new THREE.MeshPhysicalMaterial({ color: "#2a3b4d", metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.1, depthWrite: false })
    ));
    housing.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(...housingSize)),
        new THREE.LineBasicMaterial({ color: new THREE.Color(COLORS.cyan).multiplyScalar(1.4), transparent: true, opacity: 0.8, toneMapped: false })
    ));
    scene.add(housing);

    // ---- Part info -------------------------------------------------------------------------
    const staticInfo = {
        "flywheel": ["Flywheel", "Bolted to the crankshaft. It spins at engine speed and is one side of the clutch.", "Cast iron simulation", "Stores rotational energy and gives the clutch a friction surface."],
        "clutch-disc": ["Clutch Disc", "A friction disc splined to the input shaft. It only turns at engine speed when the clutch is fully closed. Watch it lag behind the flywheel while the clutch slips.", "Friction lining on steel", "Connects and disconnects engine and gearbox."],
        "pressure-plate": ["Pressure Plate", "Clamps the clutch disc against the flywheel. Pressing the pedal pulls it away.", "Steel simulation", "Applies the clamping force that locks the clutch."],
        "input-shaft": ["Input Shaft", "Carries engine power from the clutch into the gearbox. It always drives the countershaft through the input gear pair.", "Hardened steel simulation", "Delivers engine torque to the gear train."],
        "output-shaft": ["Output Shaft", "Sits in line with the input shaft. The gears ride freely on it until a sleeve locks one of them. It always turns with the wheels.", "Hardened steel simulation", "Sends torque on to the final drive."],
        "countershaft": ["Countershaft", "Turns whenever the input shaft turns. One gear from every pair is fixed to it.", "Hardened steel simulation", "Distributes input power to all the gear pairs."],
        "input-gear": ["Input Gear", `${INPUT_PAIR.input} teeth, fixed to the input shaft. It drives the countershaft gear (${INPUT_PAIR.counter} teeth), a 1.5:1 reduction shared by every gear.`, "Case-hardened steel simulation", "Starts the power path through the gearbox."],
        "counter-input-gear": ["Countershaft Input Gear", `${INPUT_PAIR.counter} teeth. Meshed with the input gear at all times.`, "Case-hardened steel simulation", "Turns the countershaft."],
        "idler": ["Reverse Idler", `${REVERSE_IDLER.teeth} teeth. Sits between the reverse gears so the output turns the opposite way.`, "Case-hardened steel simulation", "Flips the direction of rotation for reverse."],
        "fork": ["Shift Fork", "Slides a sleeve along its hub when you change gear. Only one sleeve may be engaged at a time.", "Steel simulation", "Moves the synchro sleeve."],
        "flange": ["Output Flange", "Where the gearbox hands torque to the driveshaft. The AWD module will connect here.", "Forged steel simulation", "Connects to the driveshaft."]
    };

    function infoFor(key) {
        if (staticInfo[key]) return staticInfo[key];

        if (key.startsWith("sleeve-")) {
            const def = SLEEVES[Number(key.slice(7))];
            return [`Synchro Sleeve (${def.name})`, "Locks a free-spinning gear to the output shaft. Real gearboxes use a cone synchroniser first to match the speeds so the dogs engage without a crunch.", "Steel and brass simulation", "Selects a gear."];
        }

        const [kind, gearText] = key.split("-");
        const gear = Number(gearText);
        const entry = GEARS.find((g) => g.gear === gear);
        if (!entry) return null;

        const name = gear === -1 ? "Reverse" : ordinal(gear);
        const ratio = gearRatio(gear).toFixed(2);

        if (kind === "main") {
            return [`${name} Gear (Output)`, `${entry.main} teeth. It rides freely on the output shaft until its sleeve locks it. Overall ratio ${ratio}:1 before the ${FINAL_DRIVE}:1 final drive.`, "Case-hardened steel simulation", "Transfers torque to the output shaft when selected."];
        }
        return [`${name} Gear (Countershaft)`, `${entry.counter} teeth, fixed to the countershaft. Always turning while the input shaft turns.`, "Case-hardened steel simulation", "Drives its partner gear on the output shaft."];
    }

    const MATERIAL_HIGHLIGHT = new THREE.Color("#00e5ff");
    let selected = null;

    function showInfo(key) {
        const info = key ? infoFor(key) : null;
        if (ui.partName) ui.partName.textContent = info ? info[0].toUpperCase() : "NO PART SELECTED";
        if (ui.partDesc) ui.partDesc.textContent = info ? info[1] : "Click a component in the gearbox to inspect it.";
        if (ui.partMaterial) ui.partMaterial.textContent = info ? info[2] : "—";
        if (ui.partFunction) ui.partFunction.textContent = info ? info[3] : "—";
    }

    showInfo(null);

    // ---- Picking ---------------------------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;

    const pointerTo = (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    };
    const pick = () => {
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(pickables, false)[0];
        return hit ? hit.object : null;
    };

    renderer.domElement.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener("pointerup", (e) => {
        if (!downAt) return;
        const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
        downAt = null;
        if (moved > 5) return;
        pointerTo(e);
        const hit = pick();
        selected = hit && hit !== selected ? hit : null;
        showInfo(selected ? selected.userData.partKey : null);
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
        if (e.buttons) return;
        pointerTo(e);
        renderer.domElement.style.cursor = pick() ? "pointer" : "grab";
    });

    // ---- Simulation + controls ------------------------------------------------------------------
    const sim = createDrivetrain();
    const auto = createAuto();
    let autoEnabled = false;

    // Shared state for the AWD, air-suspension and hybrid modules to read later.
    // Shared bus. The engine page publishes bus.engine; link.engine decides
    // whether the engine follows this gearbox (rpm, boost) and the gearbox
    // follows the engine's ON/OFF switch.
    const bus = (window.machina = window.machina || {});
    bus.drivetrain = sim;
    bus.link = bus.link || { engine: false };

    let linked = false;
    let linkApplied = false;
    const linkButton = $("#gb-link");

    const refreshLink = () => {
        if (!linkButton) return;
        const hasEngine = !!bus.engine;
        linkButton.disabled = !hasEngine;
        linkButton.textContent = hasEngine
            ? `ENGINE LINK: ${bus.link.engine ? "ON" : "OFF"}`
            : "ENGINE LINK: NO ENGINE ON PAGE";
        linkButton.classList.toggle("active", hasEngine && bus.link.engine);
    };

    linkButton?.addEventListener("click", () => {
        bus.link.engine = !bus.link.engine;
        refreshLink();
        window.dispatchEvent(new CustomEvent("machina-link-change"));
    });
    window.addEventListener("machina-link-change", refreshLink);
    refreshLink();

    const sliders = { throttle: 0, clutch: 0, brake: 0 };
    const keys = new Set();
    const keyed = { throttle: 0, clutch: 0, brake: 0 };
    let keysEnabled = false;

    for (const name of ["throttle", "clutch", "brake"]) {
        ui[name]?.addEventListener("input", () => { sliders[name] = Number(ui[name].value); });
    }

    document.addEventListener("pointerdown", (event) => {
        keysEnabled = !!ui.section && ui.section.contains(event.target);
    });

    const shiftBy = (delta) => {
        const order = [-1, 0, 1, 2, 3, 4, 5, 6];
        const index = order.indexOf(sim.targetGear);
        const next = order[clamp(index + delta, 0, order.length - 1)];
        requestGear(sim, next);
    };

    document.addEventListener("keydown", (event) => {
        if (!keysEnabled || event.repeat && event.code !== "Space") return;
        if (event.target.closest?.("input[type=text], textarea")) return;

        const handled = { KeyW: "throttle", KeyS: "brake", Space: "clutch" };
        if (handled[event.code]) {
            keys.add(event.code);
            event.preventDefault();
        } else if (event.code === "KeyE") { shiftBy(1); event.preventDefault(); }
        else if (event.code === "KeyQ") { shiftBy(-1); event.preventDefault(); }
        else if (event.code === "KeyN") { requestGear(sim, 0); event.preventDefault(); }
    });
    document.addEventListener("keyup", (event) => keys.delete(event.code));
    window.addEventListener("blur", () => keys.clear());

    ui.gearButtons.forEach((button) => {
        button.addEventListener("click", () => requestGear(sim, Number(button.dataset.gear)));
    });

    const setToggle = (button, on, label) => {
        if (!button) return;
        button.textContent = `${label}: ${on ? "ON" : "OFF"}`;
        button.classList.toggle("active", on);
    };

    ui.auto?.addEventListener("click", () => {
        autoEnabled = !autoEnabled;
        if (!autoEnabled) {
            auto.demo = false; auto.phase = "run"; auto.pedal = 0;
            for (const name of ["throttle", "clutch", "brake"]) {
                sliders[name] = 0;
                if (ui[name]) ui[name].value = 0;
            }
        }
        setToggle(ui.auto, autoEnabled, "AUTO CLUTCH + SHIFT");
        setToggle(ui.demo, auto.demo, "DEMO DRIVE");
    });

    ui.demo?.addEventListener("click", () => {
        auto.demo = !auto.demo;
        if (auto.demo) { autoEnabled = true; auto.t = 0; }
        setToggle(ui.auto, autoEnabled, "AUTO CLUTCH + SHIFT");
        setToggle(ui.demo, auto.demo, "DEMO DRIVE");
    });

    let housingOn = true;
    ui.housing?.addEventListener("click", () => {
        housingOn = !housingOn;
        housing.visible = housingOn;
        setToggle(ui.housing, housingOn, "HOUSING");
    });

    setToggle(ui.auto, false, "AUTO CLUTCH + SHIFT");
    setToggle(ui.demo, false, "DEMO DRIVE");
    setToggle(ui.housing, true, "HOUSING");

    // camera fly-to
    const tween = { active: false, t: 0, fromP: new THREE.Vector3(), fromT: new THREE.Vector3() };
    controls.addEventListener("start", () => { tween.active = false; });
    ui.reset?.addEventListener("click", () => {
        if (prefersReducedMotion) { camera.position.copy(cameraStart); controls.target.copy(targetStart); return; }
        tween.fromP.copy(camera.position);
        tween.fromT.copy(controls.target);
        tween.t = 0;
        tween.active = true;
    });

    // ---- Per-frame update ------------------------------------------------------------------------
    const angle = { flywheel: 0, input: 0, output: 0 };
    const glowColor = new THREE.Color(COLORS.orange);
    const inputGlow = new THREE.Color(COLORS.cyan);
    const allGearMeshes = [
        gearParts.input.mesh, gearParts.counterInput.mesh, gearParts.idler.mesh,
        ...Object.values(gearParts.mains).map((p) => p.mesh),
        ...Object.values(gearParts.counters).map((p) => p.mesh)
    ];

    function setGlow(mesh, color, intensity) {
        mesh.material.emissive.copy(color);
        mesh.material.emissiveIntensity = intensity;
    }

    function stepSim(dt) {
        const user = {
            throttle: Math.max(sliders.throttle, keyed.throttle),
            pedal: Math.max(sliders.clutch, keyed.clutch),
            brake: Math.max(sliders.brake, keyed.brake)
        };

        keyed.throttle = approach(keyed.throttle, keys.has("KeyW") ? 1 : 0, 9, dt);
        keyed.clutch = approach(keyed.clutch, keys.has("Space") ? 1 : 0, 22, dt);
        keyed.brake = approach(keyed.brake, keys.has("KeyS") ? 1 : 0, 16, dt);

        const ctrl = autoEnabled ? autoDrive(sim, auto, user, dt) : user;

        // Link to the engine page as soon as it exists (first frame only, so the
        // user can still switch it off).
        if (!linkApplied && bus.engine) {
            linkApplied = true;
            bus.link.engine = true;
            refreshLink();
            window.dispatchEvent(new CustomEvent("machina-link-change"));
        }
        linked = !!(bus.link.engine && bus.engine);

        stepDrivetrain(sim, dt, { ...ctrl, running: linked ? bus.engine.running !== false : true });

        // keep the on-screen sliders in step with automatic driving
        if (autoEnabled) {
            if (ui.throttle) ui.throttle.value = ctrl.throttle;
            if (ui.brake) ui.brake.value = ctrl.brake;
            if (ui.clutch) ui.clutch.value = ctrl.pedal;
        }

        angle.flywheel += sim.rpm * RAD_PER_RPM_SEC * dt;
        angle.input += sim.inputRpm * RAD_PER_RPM_SEC * dt;
        angle.output += sim.outputRpm * RAD_PER_RPM_SEC * dt;

        renderTelemetry(dt);
    }

    function updateVisuals(time, dt) {
        // sleeve flash when a gear locks in
        if (sim.gear !== lastGear) {
            if (sim.gear !== 0) {
                const hit = sleeveTargetFor(sim.gear);
                if (hit) sleeveFlash[hit.sleeve] = 1;
            }
            lastGear = sim.gear;
        }
        sleeveMeshes.forEach((mesh, i) => {
            sleeveFlash[i] = Math.max(0, sleeveFlash[i] - dt * 3.5);
            mesh.material.emissive.set(COLORS.orange);
            mesh.material.emissiveIntensity = sleeveFlash[i] * 2;
        });

        shifter?.update(dt, time, sim);

        const a = computeGearAngles(angle.input);

        flywheelGroup.rotation.x = angle.flywheel;
        inputGroup.rotation.x = angle.input;
        outputGroup.rotation.x = angle.output;
        gearParts.input.mesh.rotation.z = angle.input;
        // counter gears and shaft sit inside counterGroup, so one rotation turns them all
        counterGroup.rotation.x = a.counter;
        gearParts.idler.mesh.rotation.z = a.idler;
        for (const g of GEARS) gearParts.mains[g.gear].mesh.rotation.z = a.mains[g.gear];

        // clutch pedal: plate pulls away from the disc
        pressurePlate.position.x = -2.26 + sim.pedal * 0.12;
        clutchDisc.position.x = -2.36;

        // shift forks and sleeves follow the core's sleeve offsets
        SLEEVES.forEach((def, i) => {
            sleeveMeshes[i].position.x = def.x + sim.sleeves[i];
            forks[i].position.x = def.x + sim.sleeves[i];
        });

        // power path glow
        allGearMeshes.forEach((m) => setGlow(m, glowColor, 0));
        const torqueFraction = clamp(Math.abs(sim.wheelTorque) / 4000, 0, 1);
        setGlow(gearParts.input.mesh, inputGlow, sim.inputRpm > 30 ? 0.25 : 0);
        setGlow(gearParts.counterInput.mesh, inputGlow, sim.inputRpm > 30 ? 0.25 : 0);

        if (sim.gear !== 0) {
            const strength = 0.35 + torqueFraction * 0.9;
            setGlow(gearParts.mains[sim.gear].mesh, glowColor, strength);
            setGlow(gearParts.counters[sim.gear].mesh, glowColor, strength);
            if (sim.gear === -1) setGlow(gearParts.idler.mesh, glowColor, strength);
        }

        if (selected && selected.material?.emissive) {
            selected.material.emissive.copy(MATERIAL_HIGHLIGHT);
            selected.material.emissiveIntensity = 0.7 + Math.sin(time * 0.006) * 0.2;
        }

        orangeLight.intensity = 10 + torqueFraction * 14;
    }

    // ---- Telemetry ------------------------------------------------------------------------------------
    let telemetryClock = 0;
    const setStat = (selector, value) => {
        const node = $(selector)?.firstChild;
        if (node && node.nodeType === Node.TEXT_NODE) node.nodeValue = `${value} `;
    };
    const text = (el, value) => { if (el && el.textContent !== String(value)) el.textContent = value; };

    function renderTelemetry(dt) {
        telemetryClock += dt;
        if (telemetryClock < 0.08) return;
        telemetryClock = 0;

        text(ui.gear, GEAR_LABEL(sim.gear));
        text(ui.rpm, Math.round(sim.rpm));
        text(ui.speed, Math.abs(Math.round(sim.speedKmh)));
        text(ui.ratio, sim.gear === 0 ? "—" : (gearRatio(sim.gear) * FINAL_DRIVE).toFixed(2));
        text(ui.input, Math.round(sim.inputRpm));
        text(ui.output, Math.round(Math.abs(sim.outputRpm)));
        text(ui.torque, Math.round(sim.wheelTorque));

        if (ui.couplingBar) ui.couplingBar.style.width = `${sim.coupling * 100}%`;
        if (ui.rpmBar) {
            ui.rpmBar.style.width = `${Math.min(sim.rpm / 8000, 1) * 100}%`;
            ui.rpmBar.classList.toggle("over", sim.rpm >= REDLINE - 200);
        }

        const direction = sim.speed < -0.3 ? "REVERSING" : "";
        const overRev = sim.overRev ? "OVER-REV: SHIFT UP" : "";
        const engineOff = linked && !sim.running ? "ENGINE OFF: START IT IN THE ENGINE LAB" : "";
        text(ui.message, sim.message || overRev || engineOff || direction);
        ui.message?.classList.toggle("warn", !!(sim.message || overRev || engineOff));

        if (linked) {
            setStat("#stat-speed", Math.abs(Math.round(sim.speedKmh)));
            setStat("#stat-throttle", Math.round(sim.throttle * 100));
            if (Number.isFinite(bus.engine.temp)) setStat("#stat-temp", Math.round(bus.engine.temp));
        }

        ui.gearButtons.forEach((b) => {
            const g = Number(b.dataset.gear);
            b.classList.toggle("active", g === sim.gear);
            b.classList.toggle("pending", g === sim.targetGear && g !== sim.gear);
        });
    }

    // ---- Loop / sizing ----------------------------------------------------------------------------------
    let lastTime = 0;
    let looping = false;

    function frame(time) {
        const dt = Math.min((time - lastTime) / 1000, 0.1);
        lastTime = time;

        if (tween.active) {
            tween.t = Math.min(tween.t + dt / 1.1, 1);
            const eased = 1 - Math.pow(1 - tween.t, 3);
            camera.position.lerpVectors(tween.fromP, cameraStart, eased);
            controls.target.lerpVectors(tween.fromT, targetStart, eased);
            if (tween.t >= 1) tween.active = false;
        }

        controls.update();
        updateVisuals(time, dt);
        composer.render(dt);
    }

    const start = () => {
        if (looping) return;
        looping = true;
        lastTime = performance.now();
        renderer.setAnimationLoop(frame);
    };
    const stop = () => { looping = false; renderer.setAnimationLoop(null); };

    // The drivetrain keeps running when the 3D view is off-screen, so a linked
    // engine viewer never freezes while you scroll.
    let simLast = performance.now();
    function simTick(now) {
        const dt = Math.min((now - simLast) / 1000, 0.1);
        simLast = now;
        stepSim(dt);
        requestAnimationFrame(simTick);
    }
    requestAnimationFrame(simTick);

    function resize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(w, h);
    }

    new ResizeObserver(resize).observe(container);
    new IntersectionObserver((entries) => (entries[0].isIntersecting ? start() : stop())).observe(container);
    start();
}