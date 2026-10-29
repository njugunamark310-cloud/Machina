import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const COLORS = {
    background: "#05080f",
    cyan: "#00e5ff",
    orange: "#ff8a00"
};

const MAX_RPM = 7000;

const SLOW_MOTION = 40;
const SHAKE_AMOUNT = 0.004;
const FLOOR_Y = -1.9;
const GAUGE_ARC = Math.PI * 80;

const FIRING_OFFSETS = [0, 540, 180, 360];

const CYLINDER_COUNT = 4;
const CRANK_RADIUS = 0.18;
const ROD_LENGTH = 0.46;
const CAM_HALF_WIDTH = 60;
const DEG = Math.PI / 180;

const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
).matches;

const $ = (selector) => document.querySelector(selector);

const mod = (value, period) => ((value % period) + period) % period;
const clamp = THREE.MathUtils.clamp;
const cylinderX = (index) => -0.57 + index * 0.38;

const container = $("#engine-canvas");

if (!container) {
    throw new Error("Engine viewer container was not found.");
}

const ui = {
    reset: $("#reset-view"),
    hologram: $("#toggle-hologram"),
    exploded: $("#toggle-exploded"),
    engine: $("#toggle-engine"),
    rpmValue: $("#rpm-value"),
    tempValue: $("#temp-value"),
    boostValue: $("#boost-value"),
    boostPressure: $("#boostPressure"),
    rpmBar: $("#rpm-bar"),
    tempBar: $("#temp-bar"),
    boostBar: $("#boost-bar"),
    gaugeText: $("#gauge-text"),
    gaugePath: $("#gauge-value"),
    partName: $("#part-name"),
    partDescription: $("#part-description"),
    partMaterial: $("#part-material"),
    partFunction: $("#part-function"),
    rpmSlider: $("#rpm-slider"),
    boostSlider: $("#boost-slider"),
    auto: $("#toggle-auto"),

    
};





const STROKES = ["POWER", "EXHAUST", "INTAKE", "COMPRESSION"];
const strokeLabels = [0, 1, 2, 3].map((i) => $(`#stroke-${i}`));

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.background);

scene.fog = new THREE.Fog(COLORS.background, 9, 22);

const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100
);

const cameraStart = new THREE.Vector3(3, 2, 5);
const cameraIntro = new THREE.Vector3(5, 3.2, 7.5);
const targetStart = new THREE.Vector3(0, 0, 0);
camera.position.copy(cameraIntro);
camera.lookAt(targetStart);

const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

renderer.domElement.setAttribute("role", "img");
renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D simulation of a turbocharged four-cylinder engine"
);
renderer.domElement.style.cursor = "grab";

container.querySelector(".engine-loading")?.remove();
container.appendChild(renderer.domElement);

const composerTarget = new THREE.WebGLRenderTarget(
    Math.max(1, container.clientWidth),
    Math.max(1, container.clientHeight),
    { type: THREE.HalfFloatType, samples: 4 }
);
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
    new UnrealBloomPass(
        new THREE.Vector2(
            Math.max(1, container.clientWidth),
            Math.max(1, container.clientHeight)
        ),
        0.55,
        0.65,
        0.82
    )
);
composer.addPass(new OutputPass());

const pmrem = new THREE.PMREMGenerator(renderer);
const studio = new RoomEnvironment();
scene.environment = pmrem.fromScene(studio, 0.04).texture;
scene.environmentIntensity = 0.65;
studio.dispose?.();
pmrem.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 10;
controls.maxPolarAngle = Math.PI * 0.52;
controls.target.copy(targetStart);
controls.autoRotate = !prefersReducedMotion;
controls.autoRotateSpeed = 0.7;

const cameraTween = {
    active: false,
    elapsed: 0,
    duration: 1,
    fromPosition: new THREE.Vector3(),
    toPosition: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3()
};

let resumeSpinTimer;
controls.addEventListener("start", () => {
    cameraTween.active = false;
    controls.autoRotate = false;
    clearTimeout(resumeSpinTimer);
});
controls.addEventListener("end", () => {
    if (prefersReducedMotion) return;
    resumeSpinTimer = setTimeout(() => {
        controls.autoRotate = true;
    }, 5000);
});

function flyTo(position, target, duration) {
    clearTimeout(resumeSpinTimer);

    if (prefersReducedMotion) {
        camera.position.copy(position);
        controls.target.copy(target);
        controls.update();
        return;
    }

    controls.autoRotate = false;
    cameraTween.fromPosition.copy(camera.position);
    cameraTween.toPosition.copy(position);
    cameraTween.fromTarget.copy(controls.target);
    cameraTween.toTarget.copy(target);
    cameraTween.duration = duration;
    cameraTween.elapsed = 0;
    cameraTween.active = true;
}

function updateCameraTween(dt) {
    if (!cameraTween.active) return;

    cameraTween.elapsed += dt;
    const t = Math.min(cameraTween.elapsed / cameraTween.duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);

    if (t >= 1) {
        cameraTween.active = false;
        controls.autoRotate = !prefersReducedMotion;
    }
}

const componentInfo = {
    "Engine Block": {
        description: "The main structure that houses the cylinders and supports major engine components.",
        material: "Cast metal simulation",
        function: "Supports the cylinders and internal moving parts."
    },
    "Crankcase": {
        description: "The lower section of the block that surrounds the crankshaft and holds it in place.",
        material: "Cast metal simulation",
        function: "Encloses the crankshaft and keeps oil inside the engine."
    },
    "Cylinder Head": {
        description: "The upper engine assembly that closes the cylinders and houses the combustion chamber area.",
        material: "Aluminium alloy simulation",
        function: "Supports the valves and combustion chamber."
    },
    "Oil Pan": {
        description: "The lower engine enclosure that represents the engine's oil reservoir.",
        material: "Metal alloy simulation",
        function: "Stores engine oil for the lubrication system."
    },
    "Cylinder": {
        description: "Represents one of the four cylinders in this simplified engine model. It glows orange when it fires, in the order 1-3-4-2.",
        material: "Metal alloy simulation",
        function: "Represents the chamber where combustion drives the piston."
    },
    "Camshaft": {
        description: "One of two overhead camshafts. Its lobes rotate at half crank speed and push the valves open in time with each stroke.",
        material: "Steel simulation",
        function: "Opens the intake and exhaust valves at the right moment."
    },
    "Intake Manifold": {
        description: "A plenum with four runners that share incoming air between the cylinders.",
        material: "Aluminium alloy simulation",
        function: "Delivers air to each cylinder."
    },
    "Exhaust Manifold": {
        description: "Collects exhaust gas from each cylinder. It glows hotter as engine load rises.",
        material: "Heat-resistant metal simulation",
        function: "Merges exhaust flow and feeds the turbocharger."
    },
    "Exhaust Pipe": {
        description: "Carries exhaust gases away from the engine in this simplified model.",
        material: "Heat-resistant metal simulation",
        function: "Represents the exhaust gas path."
    },
    "Turbocharger": {
        description: "Exhaust gas spins the turbine, which drives the compressor on the same shaft. The cyan stream shows boosted air.",
        material: "Alloy and steel simulation",
        function: "Compresses intake air to increase power."
    },
    "Oil Filter": {
        description: "A spin-on canister that cleans oil before it circulates through the engine.",
        material: "Painted steel simulation",
        function: "Removes particles from the engine oil."
    },
    "Crank Pulley": {
        description: "Sits on the end of the crankshaft. The orange mark lets you see the crank turning, slowed down so your eyes can follow it.",
        material: "Steel simulation",
        function: "In a real engine it drives belts for parts like the alternator and water pump."
    }
};

function makeGrainTexture() {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
        const rowBias = Math.random() * 40;

        for (let x = 0; x < size; x++) {
            const value = clamp(215 - rowBias + Math.random() * 30, 0, 255);
            const index = (y * size + x) * 4;
            image.data[index] = value;
            image.data[index + 1] = value;
            image.data[index + 2] = value;
            image.data[index + 3] = 255;
        }
    }

    ctx.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
}

function makeRadialTexture(stops) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

const grainTexture = makeGrainTexture();

function makeMetal(color, options = {}) {
    return new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.9,
        roughness: 0.34,
        roughnessMap: grainTexture,
        clearcoat: 0.2,
        clearcoatRoughness: 0.4,
        ...options
    });
}

const engineMaterial = makeMetal("#536579", { metalness: 0.85, roughness: 0.38 });

const headMaterial = makeMetal("#9aabbc", { roughness: 0.28 });

const oilPanMaterial = makeMetal("#354657", { metalness: 0.85, roughness: 0.4 });

const cylinderMaterialTemplate = new THREE.MeshStandardMaterial({
    color: "#60758a",
    metalness: 0.9,
    roughness: 0.24,
    emissive: COLORS.orange,
    emissiveIntensity: 0
});

const exhaustMaterial = makeMetal("#a6b4c2", { metalness: 0.95, roughness: 0.28 });

const exhaustHeatMaterial = new THREE.MeshStandardMaterial({
    color: "#8a5a45",
    metalness: 0.8,
    roughness: 0.34,
    emissive: "#ff6a1a",
    emissiveIntensity: 0
});

const boltMaterial = new THREE.MeshStandardMaterial({
    color: "#d7e6f5",
    metalness: 1,
    roughness: 0.2
});

const darkMaterial = new THREE.MeshStandardMaterial({
    color: "#0a1018",
    metalness: 0.5,
    roughness: 0.6
});

const markMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.orange,
    emissive: COLORS.orange,
    emissiveIntensity: 3
});

const hologramMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(COLORS.cyan).multiplyScalar(1.5),
    transparent: true,
    opacity: 0.9,
    toneMapped: false
});

const xrayMaterials = [
    { material: engineMaterial, ghost: 0.28 },
    { material: headMaterial, ghost: 0.4 },
    { material: oilPanMaterial, ghost: 0.5 }
];

const engineGroup = new THREE.Group();
scene.add(engineGroup);

const pickableParts = [];
const hologramParts = [];

function registerPart(mesh, partName) {
    mesh.userData.partName = partName;
    pickableParts.push(mesh);
    return mesh;
}

function addWireframe(mesh, size) {
    const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),
        hologramMaterial
    );
    wire.scale.setScalar(1.003);
    mesh.add(wire);
    hologramParts.push(wire);
    return wire;
}

function makeBadgeTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");

    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 500, 116);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.orange;
    ctx.font = "bold 64px monospace";
    ctx.fillText("MACHINA", 256, 52);
    ctx.fillStyle = COLORS.cyan;
    ctx.font = "24px monospace";
    ctx.fillText("SIMULATED 4-CYL ENGINE", 256, 100);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
}

const blockSize = [1.8, 1.5, 1.2];

const engineBlock = registerPart(
    new THREE.Mesh(new RoundedBoxGeometry(...blockSize, 3, 0.05), engineMaterial),
    "Engine Block"
);
engineGroup.add(engineBlock);
addWireframe(engineBlock, blockSize);

const ribGeometry = new THREE.BoxGeometry(0.09, 1.15, 0.08);

for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(ribGeometry, engineMaterial);
    rib.position.set(-0.68 + i * 0.34, 0, 0.62);
    engineBlock.add(rib);
}

const crankcaseSize = [1.92, 0.42, 1.28];

const crankcase = registerPart(
    new THREE.Mesh(new RoundedBoxGeometry(...crankcaseSize, 3, 0.06), engineMaterial),
    "Crankcase"
);

crankcase.position.set(0, -0.48, 0);
engineGroup.add(crankcase);
addWireframe(crankcase, crankcaseSize);

const crankcaseBoltGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.035, 12);

for (let i = 0; i < 6; i++) {
    const bolt = new THREE.Mesh(crankcaseBoltGeometry, boltMaterial);

    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(-0.72 + i * 0.288, 0, 0.665);

    crankcase.add(bolt);
}

const headSize = [1.65, 0.35, 1.1];
const cylinderHead = registerPart(
    new THREE.Mesh(new RoundedBoxGeometry(...headSize, 3, 0.04), headMaterial),
    "Cylinder Head"
);
cylinderHead.position.y = 0.92;
engineGroup.add(cylinderHead);
addWireframe(cylinderHead, headSize);

const boltGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.035, 12);

for (let i = 0; i < 6; i++) {
    const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
    const x = -0.65 + (i % 3) * 0.65;
    const z = i < 3 ? -0.42 : 0.42;
    bolt.position.set(x, 0.2, z);
    cylinderHead.add(bolt);
}

const camshaftGroup = new THREE.Group();

const camshaftMaterial = makeMetal(0x59636d, {
    metalness: 0.72,
    roughness: 0.42
});

const camLobes = [];
const camLobeGeometry = new THREE.SphereGeometry(0.085, 16, 12);
const camShaftGeometry = new THREE.CylinderGeometry(0.045, 0.045, 1.7, 24);

for (let shaftIndex = 0; shaftIndex < 2; shaftIndex++) {
    const z = -0.25 + shaftIndex * 0.5;

    const shaft = registerPart(
        new THREE.Mesh(camShaftGeometry, camshaftMaterial),
        "Camshaft"
    );

    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(0, 0, z);
    camshaftGroup.add(shaft);

    for (let i = 0; i < CYLINDER_COUNT; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(cylinderX(i), 0, z);

        const lobe = new THREE.Mesh(camLobeGeometry, boltMaterial);
        lobe.scale.set(1, 1.5, 0.8);
        lobe.position.y = 0.035;
        pivot.add(lobe);

        camshaftGroup.add(pivot);

        const openCrank = (shaftIndex === 1 ? 450 : 270) + FIRING_OFFSETS[i];
        camLobes.push({ pivot, openCrank, phase: 180 - openCrank / 2 });
    }
}

camshaftGroup.position.y = 1.17;
engineGroup.add(camshaftGroup);

const valveGroup = new THREE.Group();

const valveMaterial = new THREE.MeshStandardMaterial({
    color: 0xd5dde5,
    metalness: 0.85,
    roughness: 0.25
});

const springMaterial = new THREE.MeshStandardMaterial({
    color: 0xe87532,
    metalness: 0.65,
    roughness: 0.3,
    side: THREE.DoubleSide
});

const valveStemGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.22, 12);
const valveHeadGeometry = new THREE.CylinderGeometry(0.055, 0.04, 0.025, 20);
const valveSpringGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.09, 16, 1, true);

const valveRigs = [];

for (let i = 0; i < CYLINDER_COUNT; i++) {
    for (let v = 0; v < 2; v++) {
        const x = cylinderX(i);
        const z = -0.25 + v * 0.5;

        const stem = new THREE.Mesh(valveStemGeometry, valveMaterial);
        stem.position.set(x, 0.91, z);
        valveGroup.add(stem);

        const valveHead = new THREE.Mesh(valveHeadGeometry, valveMaterial);
        valveHead.position.set(x, 0.79, z);
        valveGroup.add(valveHead);

        const spring = new THREE.Mesh(valveSpringGeometry, springMaterial);
        spring.position.set(x, 1.02, z);
        valveGroup.add(spring);

        valveRigs.push({
            stem,
            valveHead,
            spring,
            openCrank: (v === 1 ? 450 : 270) + FIRING_OFFSETS[i]
        });
    }
}

engineGroup.add(valveGroup);

const intakeGroup = new THREE.Group();

const intakeMaterial = makeMetal(0x168da5, {
    metalness: 0.75,
    roughness: 0.34
});

const intakePlenum = registerPart(
    new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.6, 24), intakeMaterial),
    "Intake Manifold"
);

intakePlenum.rotation.z = Math.PI / 2;
intakePlenum.position.set(0, 0.45, 0.82);
intakeGroup.add(intakePlenum);

const intakeRunnerGeometry = new THREE.CylinderGeometry(0.055, 0.075, 0.42, 16);

for (let i = 0; i < CYLINDER_COUNT; i++) {
    const runner = registerPart(
        new THREE.Mesh(intakeRunnerGeometry, intakeMaterial),
        "Intake Manifold"
    );

    runner.position.set(cylinderX(i), 0.2, 0.65);
    runner.rotation.x = -0.25;
    intakeGroup.add(runner);
}

engineGroup.add(intakeGroup);

const exhaustManifoldGroup = new THREE.Group();

const exhaustRunnerGeometry = new THREE.CylinderGeometry(0.045, 0.055, 0.65, 16);

for (let i = 0; i < CYLINDER_COUNT; i++) {
    const runner = registerPart(
        new THREE.Mesh(exhaustRunnerGeometry, exhaustHeatMaterial),
        "Exhaust Manifold"
    );

    runner.position.set(cylinderX(i), 0.05, -0.72);
    runner.rotation.z = (i - 1.5) * 0.16;
    exhaustManifoldGroup.add(runner);
}

const exhaustCollector = registerPart(
    new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.48, 20), exhaustHeatMaterial),
    "Exhaust Manifold"
);

exhaustCollector.rotation.x = Math.PI / 2;
exhaustCollector.position.set(0, -0.12, -1.05);
exhaustManifoldGroup.add(exhaustCollector);

engineGroup.add(exhaustManifoldGroup);

const oilFilterGroup = new THREE.Group();

const oilFilterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc83232,
    metalness: 0.45,
    roughness: 0.35,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25
});

const oilFilterBody = registerPart(
    new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.38, 32), oilFilterMaterial),
    "Oil Filter"
);

oilFilterBody.position.set(-0.62, -0.42, 0.64);
oilFilterGroup.add(oilFilterBody);

const oilFilterCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.145, 0.145, 0.035, 32),
    boltMaterial
);
oilFilterCap.position.set(-0.62, -0.22, 0.64);
oilFilterGroup.add(oilFilterCap);

engineGroup.add(oilFilterGroup);

const turboGroup = new THREE.Group();

const turboHousingMaterial = makeMetal(0x8998a5, { roughness: 0.3 });
// turbo 
const turbineHousing = registerPart(
    new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.09, 16, 32), turboHousingMaterial),
    "Turbocharger"
);

turbineHousing.position.set(0.65, -0.05, -1.1);
turboGroup.add(turbineHousing);

const compressorHousing = registerPart(
    new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.075, 16, 32), turboHousingMaterial),
    "Turbocharger"
);

compressorHousing.position.set(0.65, -0.05, -0.78);
turboGroup.add(compressorHousing);

const turboShaft = registerPart(
    new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.38, 20), boltMaterial),
    "Turbocharger"
);

turboShaft.rotation.x = Math.PI / 2;
turboShaft.position.set(0.65, -0.05, -0.94);
turboGroup.add(turboShaft);

const turboInletMaterial = makeMetal(0x8998a5, {
    metalness: 0.92,
    roughness: 0.26
});

const inletElbow = new THREE.Group();

const inletSection = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.075, 0.22, 32),
    turboInletMaterial
);
inletSection.rotation.x = Math.PI / 2;
inletSection.position.z = 0.08;
inletElbow.add(inletSection);

const inletLip = new THREE.Mesh(
    new THREE.TorusGeometry(0.105, 0.018, 12, 32),
    turboInletMaterial
);
inletLip.position.z = 0.19;
inletElbow.add(inletLip);

inletElbow.position.set(0.65, -0.05, -1.28);
turboGroup.add(inletElbow);

const turboOutletMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x168da5,
    metalness: 0.4,
    roughness: 0.2,
    transparent: true,
    opacity: 0.45,
    depthWrite: false
});

const turboOutletPipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.08, 0.5, 20),
    turboOutletMaterial
);

turboOutletPipe.position.set(0.65, 0.12, -0.48);
turboOutletPipe.rotation.x = Math.PI / 2;
turboGroup.add(turboOutletPipe);

const boostFlowGroup = new THREE.Group();

const boostParticleMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x48e5ff).multiplyScalar(2),
    transparent: true,
    opacity: 0.9,
    toneMapped: false
});

const boostParticleGeometry = new THREE.SphereGeometry(0.025, 12, 12);
const boostParticles = [];
const BOOST_PARTICLE_COUNT = 18;

for (let i = 0; i < BOOST_PARTICLE_COUNT; i++) {
    const particle = new THREE.Mesh(
        boostParticleGeometry,
        boostParticleMaterial
    );

    particle.userData.progress = i / BOOST_PARTICLE_COUNT;
    particle.userData.angle = i * 2.4;
    particle.userData.radius = 0.02 + (i % 3) * 0.012;

    boostFlowGroup.add(particle);
    boostParticles.push(particle);
}

turboGroup.add(boostFlowGroup);

engineGroup.add(turboGroup);

const compressorWheel = new THREE.Group();

const compressorBladeMaterial = new THREE.MeshStandardMaterial({
    color: 0x48c9d8,
    metalness: 0.8,
    roughness: 0.25
});

const compressorHub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.045, 24),
    turboHousingMaterial
);

compressorHub.rotation.x = Math.PI / 2;
compressorWheel.add(compressorHub);

const wheelBladeGeometry = new THREE.BoxGeometry(0.035, 0.15, 0.018);

for (let i = 0; i < 8; i++) {
    const blade = new THREE.Mesh(wheelBladeGeometry, compressorBladeMaterial);

    const angle = (i / 8) * Math.PI * 2;

    blade.position.set(
        Math.cos(angle) * 0.105,
        Math.sin(angle) * 0.105,
        0
    );

    blade.rotation.z = angle + 0.45;
    compressorWheel.add(blade);
}

compressorWheel.position.set(0.65, -0.05, -0.78);
turboGroup.add(compressorWheel);

const turbineWheel = new THREE.Group();

const turbineBladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xe87532,
    metalness: 0.85,
    roughness: 0.28,
    emissive: 0xff4a00,
    emissiveIntensity: 0
});

const turbineHub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.045, 24),
    turboHousingMaterial
);

turbineHub.rotation.x = Math.PI / 2;
turbineWheel.add(turbineHub);

for (let i = 0; i < 8; i++) {
    const blade = new THREE.Mesh(wheelBladeGeometry, turbineBladeMaterial);

    const angle = (i / 8) * Math.PI * 2;

    blade.position.set(
        Math.cos(angle) * 0.105,
        Math.sin(angle) * 0.105,
        0
    );

    blade.rotation.z = angle - 0.45;
    turbineWheel.add(blade);
}

turbineWheel.position.set(0.65, -0.05, -1.1);
turboGroup.add(turbineWheel);

const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.25),
    new THREE.MeshBasicMaterial({
        map: makeBadgeTexture(),
        transparent: true,
        depthWrite: false,
        toneMapped: false
    })
);
badge.rotation.x = -Math.PI / 2;
badge.position.y = 0.178;
cylinderHead.add(badge);

const cylinderGeometry = new THREE.CylinderGeometry(0.19, 0.19, 0.65, 32);
const cylinderFinGeometry = new THREE.TorusGeometry(0.195, 0.012, 8, 40);
const cylinderParts = [];
const cylinderMaterials = [];

for (let i = 0; i < CYLINDER_COUNT; i++) {
    const material = cylinderMaterialTemplate.clone();
    const cylinder = registerPart(
        new THREE.Mesh(cylinderGeometry, material),
        "Cylinder"
    );
    cylinder.position.set(cylinderX(i), 0.38, 0.48);

    for (let f = 0; f < 5; f++) {
        const fin = new THREE.Mesh(cylinderFinGeometry, darkMaterial);
        fin.rotation.x = Math.PI / 2;
        fin.position.y = -0.2 + f * 0.1;
        cylinder.add(fin);
    }

    engineGroup.add(cylinder);
    cylinderParts.push(cylinder);
    cylinderMaterials.push(material);
}

const flashTexture = makeRadialTexture([
    [0, "rgba(255, 220, 150, 1)"],
    [0.4, "rgba(255, 120, 20, 0.6)"],
    [1, "rgba(255, 80, 0, 0)"]
]);

const combustionFlashes = cylinderParts.map((cylinder) => {
    const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: flashTexture,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        })
    );
    sprite.position.set(0, 0.15, 0.3);
    cylinder.add(sprite);

    const light = new THREE.PointLight(COLORS.orange, 0, 1.6);
    light.position.set(0, 0.2, 0.45);
    cylinder.add(light);

    return { sprite, light };
});

const crankshaftGroup = new THREE.Group();
const crankshaftMaterial = makeMetal(0x8c9ba8, { roughness: 0.3 });

const crankshaftMain = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 1.55, 24),
    crankshaftMaterial
);

crankshaftMain.rotation.z = Math.PI / 2;
crankshaftGroup.add(crankshaftMain);

const crankNose = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.32, 24),
    crankshaftMaterial
);

crankNose.rotation.z = Math.PI / 2;
crankNose.position.x = 0.93;
crankshaftGroup.add(crankNose);

const connectingRodMaterial = new THREE.MeshStandardMaterial({
    color: 0xd97732,
    metalness: 0.75,
    roughness: 0.3
});

const pistonMaterial = new THREE.MeshStandardMaterial({
    color: 0xc4ccd3,
    metalness: 0.85,
    roughness: 0.22
});

const crankPinGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.24, 20);
const crankWebGeometry = new THREE.BoxGeometry(0.22, CRANK_RADIUS + 0.12, 0.09);
const counterweightGeometry = new THREE.BoxGeometry(0.22, 0.14, 0.1);
const connectingRodGeometry = new THREE.BoxGeometry(0.09, ROD_LENGTH, 0.07);
const pistonGeometry = new THREE.CylinderGeometry(0.145, 0.145, 0.22, 32);
const pistonRingGeometry = new THREE.TorusGeometry(0.148, 0.009, 8, 32);
const pistonRingOffsets = [0.08, 0.04, 0];

const pistonRigs = [];

for (let i = 0; i < CYLINDER_COUNT; i++) {
    const x = cylinderX(i);

    const pin = new THREE.Mesh(crankPinGeometry, crankshaftMaterial);
    pin.rotation.z = Math.PI / 2;
    pin.position.x = x;

    const web = new THREE.Mesh(crankWebGeometry, crankshaftMaterial);
    web.position.x = x;

    const counterweight = new THREE.Mesh(counterweightGeometry, crankshaftMaterial);
    counterweight.position.x = x;

    const rod = new THREE.Mesh(connectingRodGeometry, connectingRodMaterial);
    rod.position.x = x;

    const piston = new THREE.Group();
    piston.position.x = x;
    piston.add(new THREE.Mesh(pistonGeometry, pistonMaterial));

    pistonRingOffsets.forEach((offset) => {
        const ring = new THREE.Mesh(pistonRingGeometry, boltMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = offset;
        piston.add(ring);
    });

    crankshaftGroup.add(pin, web, counterweight, rod, piston);

    pistonRigs.push({
        pin,
        web,
        counterweight,
        rod,
        piston,
        phase: i === 1 || i === 2 ? 180 : 0
    });
}

crankshaftGroup.position.y = -0.2;
engineGroup.add(crankshaftGroup);

const oilPanSize = [1.35, 0.38, 1.0];
const oilPan = registerPart(
    new THREE.Mesh(new RoundedBoxGeometry(...oilPanSize, 3, 0.04), oilPanMaterial),
    "Oil Pan"
);
oilPan.position.set(0, -0.85, 0);
engineGroup.add(oilPan);
addWireframe(oilPan, oilPanSize);

const sideBoltGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12);

for (let i = 0; i < 3; i++) {
    const sideBolt = new THREE.Mesh(sideBoltGeometry, boltMaterial);
    sideBolt.rotation.x = Math.PI / 2;
    sideBolt.position.set(-0.48 + i * 0.48, 0, 0.53);
    oilPan.add(sideBolt);
}

const exhaustGeometry = new THREE.CylinderGeometry(0.075, 0.095, 0.7, 16);
const exhaustParts = [];

for (let i = 0; i < CYLINDER_COUNT; i++) {
    const exhaustPipe = registerPart(
        new THREE.Mesh(exhaustGeometry, exhaustMaterial),
        "Exhaust Pipe"
    );
    exhaustPipe.position.set(cylinderX(i), -0.05, -0.68);
    exhaustPipe.rotation.x = Math.PI / 2;
    engineGroup.add(exhaustPipe);
    exhaustParts.push(exhaustPipe);
}

const pulleyGroup = new THREE.Group();
pulleyGroup.position.set(1.0, -0.2, 0);
engineGroup.add(pulleyGroup);

const pulleyDisc = registerPart(
    new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.1, 48).rotateZ(Math.PI / 2),
        headMaterial
    ),
    "Crank Pulley"
);
pulleyGroup.add(pulleyDisc);

const pulleyHub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.2, 24).rotateZ(Math.PI / 2),
    boltMaterial
);
pulleyHub.position.x = 0.05;
pulleyGroup.add(pulleyHub);

const pulleySpinner = new THREE.Group();
pulleySpinner.position.x = 0.051;
pulleyGroup.add(pulleySpinner);

const holeGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16).rotateZ(Math.PI / 2);

for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const hole = new THREE.Mesh(holeGeometry, darkMaterial);
    hole.position.set(0, Math.cos(angle) * 0.27, Math.sin(angle) * 0.27);
    pulleySpinner.add(hole);
}

const timingMark = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.12, 0.04),
    markMaterial
);
timingMark.position.set(0, 0.34, 0);
pulleySpinner.add(timingMark);

engineGroup.traverse((object) => {
    if (!object.isMesh || object.material.isMeshBasicMaterial) return;
    object.castShadow = true;
    object.receiveShadow = true;
});

turboOutletPipe.castShadow = false;

const floorGroup = new THREE.Group();
floorGroup.position.y = FLOOR_Y;
scene.add(floorGroup);

const grid = new THREE.GridHelper(24, 48, COLORS.cyan, "#12384f");
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.material.toneMapped = false;
floorGroup.add(grid);

const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ color: 0x000814, opacity: 0.55 })
);
shadowCatcher.position.y = 0.002;
shadowCatcher.receiveShadow = true;
floorGroup.add(shadowCatcher);

const glowPool = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
        map: makeRadialTexture([
            [0, "rgba(0, 229, 255, 0.22)"],
            [1, "rgba(0, 229, 255, 0)"]
        ]),
        transparent: true,
        depthWrite: false,
        toneMapped: false
    })
);
glowPool.position.y = 0.004;
floorGroup.add(glowPool);

const ringMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLORS.cyan).multiplyScalar(2),
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false
});

const staticRing = new THREE.Mesh(
    new THREE.RingGeometry(2.5, 2.54, 128).rotateX(-Math.PI / 2),
    ringMaterial
);
staticRing.position.y = 0.008;
floorGroup.add(staticRing);

const pulseRing = new THREE.Mesh(
    new THREE.RingGeometry(2.5, 2.54, 128).rotateX(-Math.PI / 2),
    ringMaterial.clone()
);
pulseRing.position.y = 0.012;
floorGroup.add(pulseRing);

const scanGroup = new THREE.Group();
const scanGeometry = new THREE.PlaneGeometry(2.4, 1.6).rotateX(-Math.PI / 2);
scanGroup.add(
    new THREE.Mesh(
        scanGeometry,
        new THREE.MeshBasicMaterial({
            color: COLORS.cyan,
            transparent: true,
            opacity: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        })
    )
);
scanGroup.add(
    new THREE.LineSegments(new THREE.EdgesGeometry(scanGeometry), hologramMaterial)
);
scene.add(scanGroup);
hologramParts.push(scanGroup);

const DUST_COUNT = 260;
const dustPositions = new Float32Array(DUST_COUNT * 3);

for (let i = 0; i < DUST_COUNT; i++) {
    const radius = 2.2 + Math.random() * 4;
    const theta = Math.random() * Math.PI * 2;
    dustPositions[i * 3] = Math.cos(theta) * radius;
    dustPositions[i * 3 + 1] = FLOOR_Y + Math.random() * 5.4;
    dustPositions[i * 3 + 2] = Math.sin(theta) * radius;
}

const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));

const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
        color: new THREE.Color(COLORS.cyan).multiplyScalar(1.4),
        size: 0.05,
        map: makeRadialTexture([
            [0, "rgba(255, 255, 255, 1)"],
            [1, "rgba(255, 255, 255, 0)"]
        ]),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
    })
);
scene.add(dust);

scene.add(new THREE.HemisphereLight("#7fdcff", "#1a0f05", 0.5));

const keyLight = new THREE.DirectionalLight("#ffffff", 2.2);
keyLight.position.set(3, 4, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -3.5;
keyLight.shadow.camera.right = 3.5;
keyLight.shadow.camera.top = 3.5;
keyLight.shadow.camera.bottom = -3.5;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 14;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);

const cyanLight = new THREE.PointLight(COLORS.cyan, 20, 10);
cyanLight.position.set(-3, 1, 2);
scene.add(cyanLight);

const ORANGE_LIGHT_BASE = 14;
const orangeLight = new THREE.PointLight(COLORS.orange, ORANGE_LIGHT_BASE, 10);
orangeLight.position.set(3, -1, -2);
scene.add(orangeLight);

const movableParts = [
    {
        object: cylinderHead,
        offset: new THREE.Vector3(0, 1.1, 0)
    },
    {
        object: camshaftGroup,
        offset: new THREE.Vector3(0, 1.5, 0)
    },
    {
        object: valveGroup,
        offset: new THREE.Vector3(0, 1.1, 0)
    },
    {
        object: oilPan,
        offset: new THREE.Vector3(0, -0.7, 0)
    },
    {
        object: pulleyGroup,
        offset: new THREE.Vector3(0.8, 0, 0)
    },
    {
        object: intakeGroup,
        offset: new THREE.Vector3(0, 0.35, 0.7)
    },
    {
        object: exhaustManifoldGroup,
        offset: new THREE.Vector3(0, 0.1, -0.8)
    },
    {
        object: turboGroup,
        offset: new THREE.Vector3(0.4, 0.15, -1.2)
    },
    {
        object: oilFilterGroup,
        offset: new THREE.Vector3(-0.4, -0.3, 0.8)
    },
    ...cylinderParts.map((object, index) => ({
        object,
        offset: new THREE.Vector3(0, 0.65, index % 2 === 0 ? 0.35 : -0.35)
    })),
    ...exhaustParts.map((object, index) => ({
        object,
        offset: new THREE.Vector3(0, -0.15, index % 2 === 0 ? -1.0 : -1.35)
    })),
    {
        object: crankcase,
        offset: new THREE.Vector3(0, -0.65, 0)
    },
    {
        object: crankshaftGroup,
        offset: new THREE.Vector3(0, -0.3, 0.8)
    }
];

for (const part of movableParts) {
    part.start = part.object.position.clone();
    part.destination = part.start.clone();
}

const sim = {
    running: true,
    manual: false,
    manualRpm: 3200,
    manualBoost: 0.8,
    rpm: 0,
    temp: 40,
    boost: 0,
    crankDeg: 0
};

let hologramEnabled = true;
let exploded = false;
let xray = 0;
let lastTime = 0;
let telemetryClock = 0;

function approach(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function camLift(crankDeg, openCrank) {
    const camAngle = (mod(crankDeg - openCrank + 360, 720) - 360) / 2;

    return Math.abs(camAngle) < CAM_HALF_WIDTH
        ? 0.5 * (1 + Math.cos((Math.PI * camAngle) / CAM_HALF_WIDTH))
        : 0;
}

function updateSimulation(time, dt) {
    const autoRpm = Math.max(800,
        3200 + Math.sin(time * 0.0012) * 2200 + Math.sin(time * 0.0031) * 500);
    const autoBoost = Math.max(0.1, 0.8 + Math.sin(time * 0.0015) * 0.65);

    const targetRpm = !sim.running ? 0 : sim.manual ? sim.manualRpm : autoRpm;
    const targetBoost = !sim.running ? 0 : sim.manual ? sim.manualBoost : autoBoost;
    const targetTemp = sim.running ? 88 + (sim.rpm / MAX_RPM) * 12 + Math.sin(time * 0.00045) * 3 : 35;

    sim.rpm = approach(sim.rpm, targetRpm, 3, dt);
    sim.temp = approach(sim.temp, targetTemp, 0.15, dt);
    sim.boost = approach(sim.boost, targetBoost, 2, dt);

    sim.crankDeg = (sim.crankDeg + (sim.rpm * 6 / SLOW_MOTION) * dt) % 720;
}

function syncAutoButton() {
    if (!ui.auto) return;
    ui.auto.textContent = sim.manual ? "MODE: MANUAL" : "MODE: AUTO";
    ui.auto.classList.toggle("active", sim.manual);
}

ui.rpmSlider?.addEventListener("input", () => {
    sim.manual = true;
    sim.manualRpm = Number(ui.rpmSlider.value);
    syncAutoButton();
});

ui.boostSlider?.addEventListener("input", () => {
    sim.manual = true;
    sim.manualBoost = Number(ui.boostSlider.value);
    syncAutoButton();
});

ui.auto?.addEventListener("click", () => {
    sim.manual = !sim.manual;
    syncAutoButton();
});

syncAutoButton();

function updateEngineVisuals(time, dt) {
    const crank = sim.crankDeg;
    const idleFade = Math.min(sim.rpm / 800, 1);
    let totalBurn = 0;

    for (let i = 0; i < CYLINDER_COUNT; i++) {
        const phase = mod(crank - FIRING_OFFSETS[i], 720) / 720;
        const burn = phase < 0.25 ? 1 - phase / 0.25 : 0;
        const glow = burn * burn * idleFade;

        const flash = combustionFlashes[i];
        flash.light.intensity = glow * 8;
        flash.sprite.material.opacity = glow;
        flash.sprite.scale.setScalar(0.12 + glow * 0.45);

        cylinderMaterials[i].emissiveIntensity = glow * 3.5;
        totalBurn += glow;

        const rig = pistonRigs[i];
        const angle = (crank + rig.phase) * DEG;
        const pinY = CRANK_RADIUS * Math.cos(angle);
        const pinZ = CRANK_RADIUS * Math.sin(angle);
        const pistonY = pinY + Math.sqrt(ROD_LENGTH * ROD_LENGTH - pinZ * pinZ);

        rig.pin.position.y = pinY;
        rig.pin.position.z = pinZ;

        rig.web.position.y = pinY * 0.5;
        rig.web.position.z = pinZ * 0.5;
        rig.web.rotation.x = angle;

        rig.counterweight.position.y = -pinY * 0.9;
        rig.counterweight.position.z = -pinZ * 0.9;
        rig.counterweight.rotation.x = angle;

        rig.rod.position.y = (pinY + pistonY) * 0.5;
        rig.rod.position.z = pinZ * 0.5;
        rig.rod.rotation.x = Math.atan2(-pinZ, pistonY - pinY);

        rig.piston.position.y = pistonY;
    }

    orangeLight.intensity = ORANGE_LIGHT_BASE + totalBurn * 10;

    camLobes.forEach((lobe) => {
        lobe.pivot.rotation.x = (crank / 2 + lobe.phase) * DEG;
    });

    valveRigs.forEach((rig) => {
        const lift = camLift(crank, rig.openCrank);

        rig.stem.position.y = 0.91 - lift * 0.05;
        rig.valveHead.position.y = 0.79 - lift * 0.05;
        rig.spring.scale.y = 1 - lift * 0.3;
    });

    pulleySpinner.rotation.x = THREE.MathUtils.degToRad(crank);

    const load = sim.rpm / MAX_RPM;
    const heat = clamp(sim.rpm / 5500, 0, 1);
    exhaustHeatMaterial.emissiveIntensity = heat * heat * 3;
    turbineBladeMaterial.emissiveIntensity = 0.15 + sim.boost * 0.9;

    const turboSpin = 3 + sim.boost * 12;
    compressorWheel.rotation.z += dt * turboSpin;
    turbineWheel.rotation.z -= dt * turboSpin;

    const flowSpeed = 0.25 + sim.boost * 0.9;
    const flowScale = clamp(sim.boost, 0.2, 1);

    boostParticles.forEach((particle) => {
        const data = particle.userData;
        data.progress = (data.progress + dt * flowSpeed) % 1;

        const swirl = data.angle + data.progress * 6;
        particle.position.set(
            0.65 + Math.cos(swirl) * data.radius,
            0.12 + Math.sin(swirl) * data.radius,
            -0.73 + data.progress * 0.5
        );
        particle.scale.setScalar(
            flowScale * (0.6 + Math.sin(data.progress * Math.PI) * 0.8)
        );
    });

    if (prefersReducedMotion) return;

    engineGroup.position.x = Math.cos(time * 0.057) * SHAKE_AMOUNT * load;
    engineGroup.position.y = Math.sin(time * 0.045) * SHAKE_AMOUNT * load;
    engineGroup.rotation.z = Math.sin(time * 0.061) * SHAKE_AMOUNT * 0.4 * load;

    const pulse = (time % 3000) / 3000;
    pulseRing.scale.setScalar(0.3 + pulse * 0.7);
    pulseRing.material.opacity = (1 - pulse) * 0.5;

    scanGroup.position.y = 0.05 + Math.sin(time * 0.0008) * 1.0;

    hologramMaterial.opacity = 0.78 + Math.sin(time * 0.004) * 0.12 + Math.random() * 0.04;

    dust.rotation.y = time * 0.00004;
    dust.position.y = Math.sin(time * 0.0003) * 0.15;

    const outlinePulse = 0.75 + Math.sin(time * 0.006) * 0.25;
    selectionOutline.material.opacity = outlinePulse;

    
}

function updateExplodedView(dt) {
    const k = 1 - Math.exp(-6 * dt);

    movableParts.forEach((part) => {
        part.object.position.lerp(part.destination, k);
    });

    xray = approach(xray, exploded ? 1 : 0, 4, dt);

    xrayMaterials.forEach((entry) => {
        const transparent = xray > 0.002;

        if (entry.material.transparent !== transparent) {
            entry.material.transparent = transparent;
            entry.material.needsUpdate = true;
        }

        entry.material.opacity = 1 - (1 - entry.ghost) * xray;
        entry.material.depthWrite = xray < 0.6;
    });
}

function renderTelemetry(dt) {
    telemetryClock += dt;
    if (telemetryClock < 0.1) return;
    telemetryClock = 0;

    const rpm = Math.round(sim.rpm);
    const temperature = Math.round(sim.temp);

    if (ui.rpmValue) ui.rpmValue.textContent = rpm;
    if (ui.tempValue) ui.tempValue.textContent = temperature;
    if (ui.boostValue) ui.boostValue.textContent = sim.boost.toFixed(1);
    if (ui.boostPressure) ui.boostPressure.textContent = sim.boost.toFixed(1);

    if (ui.rpmBar) ui.rpmBar.style.width = `${Math.min(rpm / MAX_RPM, 1) * 100}%`;
    if (ui.tempBar) ui.tempBar.style.width = `${Math.min(temperature / 130, 1) * 100}%`;
    if (ui.boostBar) ui.boostBar.style.width = `${Math.min(sim.boost / 2, 1) * 100}%`;

    if (ui.gaugeText) ui.gaugeText.textContent = rpm;

    if (ui.gaugePath) {

        const progress = Math.min(rpm / MAX_RPM, 1);
        ui.gaugePath.style.strokeDasharray = `${GAUGE_ARC}`;
        ui.gaugePath.style.strokeDashoffset = `${GAUGE_ARC * (1 - progress)}`;
    }

    strokeLabels.forEach((label, i) => {
    if (!label) return;
    const name = STROKES[Math.floor(mod(sim.crankDeg - FIRING_OFFSETS[i], 720) / 180)];
    if (label.dataset.stroke !== name) {
        label.dataset.stroke = name;
        label.textContent = name;
    }
    
});

}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedPart = null;
let hoveredPart = null;

function makeOutline(color) {
    const outline = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
            color,
            transparent: true,
            depthTest: false,
            toneMapped: false
        })
    );
    outline.renderOrder = 10;
    return outline;
}

const selectionOutline = makeOutline(new THREE.Color(COLORS.orange).multiplyScalar(2));
const hoverOutline = makeOutline(new THREE.Color(COLORS.cyan).multiplyScalar(1.4));
hoverOutline.material.opacity = 0.7;

function placeOutline(outline, mesh) {
    outline.removeFromParent();
    if (!mesh) return;

    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
    const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());

    const box = new THREE.BoxGeometry(size.x, size.y, size.z);
    outline.geometry.dispose();
    outline.geometry = new THREE.EdgesGeometry(box);
    box.dispose();

    outline.position.copy(center);
    outline.scale.setScalar(1.08);
    mesh.add(outline);
}

function showPartInfo(partName) {
    const info = componentInfo[partName];

    if (ui.partName) {
        ui.partName.textContent = info ? partName.toUpperCase() : "NO PART SELECTED";
    }
    if (ui.partDescription) {
        ui.partDescription.textContent = info
            ? info.description
            : "Click a component on the engine to inspect it.";
    }
    if (ui.partMaterial) ui.partMaterial.textContent = info ? info.material : "—";
    if (ui.partFunction) ui.partFunction.textContent = info ? info.function : "—";
}

function selectPart(mesh) {
    selectedPart = mesh;
    placeOutline(selectionOutline, mesh);
    placeOutline(hoverOutline, hoveredPart && hoveredPart !== selectedPart ? hoveredPart : null);
    showPartInfo(mesh ? mesh.userData.partName : null);
}

function setHoveredPart(mesh) {
    if (mesh === hoveredPart) return;
    hoveredPart = mesh;
    placeOutline(hoverOutline, mesh && mesh !== selectedPart ? mesh : null);
    renderer.domElement.style.cursor = mesh ? "pointer" : "grab";
}

function setPointerFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickPart() {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickableParts, false);
    return hits.length > 0 ? hits[0].object : null;
}

let pointerDownAt = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
    pointerDownAt = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", (event) => {
    if (!pointerDownAt) return;

    const moved = Math.hypot(
        event.clientX - pointerDownAt.x,
        event.clientY - pointerDownAt.y
    );
    pointerDownAt = null;

    if (moved > 5) return;

    setPointerFromEvent(event);
    const hit = pickPart();
    selectPart(hit === selectedPart ? null : hit);
});

renderer.domElement.addEventListener("pointermove", (event) => {
    if (event.buttons) return;
    setPointerFromEvent(event);
    setHoveredPart(pickPart());
});

renderer.domElement.addEventListener("pointerleave", () => {
    setHoveredPart(null);
});

showPartInfo(null);

ui.reset?.addEventListener("click", () => {
    flyTo(cameraStart, targetStart, 1.1);
});

ui.hologram?.addEventListener("click", () => {
    hologramEnabled = !hologramEnabled;

    hologramParts.forEach((part) => {
        part.visible = hologramEnabled;
    });

    ui.hologram.textContent = hologramEnabled ? "HOLOGRAM: ON" : "HOLOGRAM: OFF";
    ui.hologram.classList.toggle("active", hologramEnabled);
});

ui.exploded?.addEventListener("click", () => {
    exploded = !exploded;

    movableParts.forEach((part) => {
        part.destination = exploded
            ? part.start.clone().add(part.offset)
            : part.start.clone();
    });

    ui.exploded.textContent = exploded ? "ASSEMBLE ENGINE" : "EXPLODED VIEW";
    ui.exploded.classList.toggle("active", exploded);
});

function syncEngineButton() {
    if (!ui.engine) return;
    ui.engine.textContent = sim.running ? "ENGINE: RUNNING" : "ENGINE: OFF";
    ui.engine.classList.toggle("active", sim.running);
}

ui.engine?.addEventListener("click", () => {
    sim.running = !sim.running;
    syncEngineButton();
});

syncEngineButton();

const labelAnchors = [
    ["Cylinder Head", cylinderHead],
    ["Cylinder", cylinderParts[0]],
    ["Intake", intakePlenum],
    ["Exhaust", exhaustCollector],
    ["Turbo", turbineHousing],
    ["Oil Filter", oilFilterBody],
    ["Oil Pan", oilPan],
    ["Crank Pulley", pulleyDisc]
].map(([text, object]) => {
    const element = document.createElement("div");
    element.className = "engine-label";
    element.textContent = text;
    element.style.display = "none";
    container.appendChild(element);
    return { object, element };
});

let labelsEnabled = false;
const labelPosition = new THREE.Vector3();

function updateLabels() {
    if (!labelsEnabled) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    labelAnchors.forEach(({ object, element }) => {
        object.getWorldPosition(labelPosition);
        labelPosition.project(camera);

        element.style.display = labelPosition.z < 1 ? "block" : "none";
        element.style.transform =
            `translate(${(labelPosition.x * 0.5 + 0.5) * width}px, ${(-labelPosition.y * 0.5 + 0.5) * height}px) translate(-50%, -130%)`;
    });
}

ui.labels?.addEventListener("click", () => {
    labelsEnabled = !labelsEnabled;

    if (!labelsEnabled) {
        labelAnchors.forEach(({ element }) => {
            element.style.display = "none";
        });
    }

    ui.labels.textContent = labelsEnabled ? "LABELS: ON" : "LABELS: OFF";
    ui.labels.classList.toggle("active", labelsEnabled);
});



function animate(time) {

    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    updateCameraTween(dt);
    controls.update();
    updateSimulation(time, dt);
    updateEngineVisuals(time, dt);
    updateExplodedView(dt);
    renderTelemetry(dt);

    composer.render(dt);
}

let isLooping = false;

function startLoop() {
    if (isLooping) return;
    isLooping = true;
    lastTime = performance.now();
    renderer.setAnimationLoop(animate);
}

function stopLoop() {
    isLooping = false;
    renderer.setAnimationLoop(null);
}

function resizeRenderer() {
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
}

new ResizeObserver(resizeRenderer).observe(container);

new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
        startLoop();
    } else {
        stopLoop();
    }
}).observe(container);

resizeRenderer();
flyTo(cameraStart, targetStart, 2.6);
startLoop();