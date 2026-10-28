import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

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

const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
).matches;

const $ = (selector) => document.querySelector(selector);

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
    rpmBar: $("#rpm-bar"),
    tempBar: $("#temp-bar"),
    boostBar: $("#boost-bar"),
    gaugeText: $("#gauge-text"),
    gaugePath: $("#gauge-value"),
    partName: $("#part-name"),
    partDescription: $("#part-description"),
    partMaterial: $("#part-material"),
    partFunction: $("#part-function")
};

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
const targetStart = new THREE.Vector3(0, 0, 0);
camera.position.copy(cameraStart);
camera.lookAt(targetStart);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

container.querySelector(".engine-loading")?.remove();
container.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
const studio = new RoomEnvironment();
scene.environment = pmrem.fromScene(studio, 0.04).texture;
scene.environmentIntensity = 0.55;
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

let resumeSpinTimer;
controls.addEventListener("start", () => {
    controls.autoRotate = false;
    clearTimeout(resumeSpinTimer);
});
controls.addEventListener("end", () => {
    if (prefersReducedMotion) return;
    resumeSpinTimer = setTimeout(() => {
        controls.autoRotate = true;
    }, 5000);
});

const componentInfo = {
    "Engine Block": {
        description: "The main structure that houses the cylinders and supports major engine components.",
        material: "Cast metal simulation",
        function: "Supports the cylinders and internal moving parts."
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
    "Exhaust Pipe": {
        description: "Carries exhaust gases away from the engine in this simplified model.",
        material: "Heat-resistant metal simulation",
        function: "Represents the exhaust gas path."
    },
    "Crank Pulley": {
        description: "Sits on the end of the crankshaft. The orange mark lets you see the crank turning, slowed down so your eyes can follow it.",
        material: "Steel simulation",
        function: "In a real engine it drives belts for parts like the alternator and water pump."
    }
};

const engineMaterial = new THREE.MeshStandardMaterial({
    color: "#536579",
    metalness: 0.85,
    roughness: 0.3
});

const headMaterial = new THREE.MeshStandardMaterial({
    color: "#9aabbc",
    metalness: 0.9,
    roughness: 0.22
});

const oilPanMaterial = new THREE.MeshStandardMaterial({
    color: "#354657",
    metalness: 0.85,
    roughness: 0.32
});

const cylinderMaterialTemplate = new THREE.MeshStandardMaterial({
    color: "#60758a",
    metalness: 0.9,
    roughness: 0.24,
    emissive: COLORS.orange,
    emissiveIntensity: 0
});

const exhaustMaterial = new THREE.MeshStandardMaterial({
    color: "#a6b4c2",
    metalness: 0.95,
    roughness: 0.22
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
    emissiveIntensity: 1.2
});

const hologramMaterial = new THREE.LineBasicMaterial({
    color: COLORS.cyan,
    transparent: true,
    opacity: 0.9,
    toneMapped: false
});

const engineGroup = new THREE.Group();
scene.add(engineGroup);

const pickableParts = [];
const hologramParts = [];

function registerPart(mesh, partName) {
    mesh.userData.partName = partName;
    pickableParts.push(mesh);
    return mesh;
}

function addWireframe(boxGeometry, position) {
    const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeometry),
        hologramMaterial
    );
    wire.scale.setScalar(1.003);
    wire.position.copy(position);
    engineGroup.add(wire);
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
addWireframe(new THREE.BoxGeometry(...blockSize), engineBlock.position);


const crankcaseBoltGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.035, 12);

for (let i = 0; i < 6; i++) {
    const bolt = new THREE.Mesh(crankcaseBoltGeometry, boltMaterial);

    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(-0.72 + i * 0.288, -0.48, 0.665);

    engineGroup.add(bolt);
}


const ribGeometry = new THREE.BoxGeometry(0.09, 1.15, 0.08);

for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(ribGeometry, engineMaterial);
    rib.position.set(-0.68 + i * 0.34, 0, 0.62);
    engineGroup.add(rib);
}


const crankcaseGeometry = new RoundedBoxGeometry(1.92, 0.42, 1.28, 3, 0.06);

const crankcase = registerPart(
    new THREE.Mesh(crankcaseGeometry, engineMaterial),
    "Crankcase"
);

crankcase.position.set(0, -0.48, 0);
engineGroup.add(crankcase);

addWireframe(
    new THREE.BoxGeometry(1.92, 0.42, 1.28),
    crankcase.position
);


const headSize = [1.65, 0.35, 1.1];
const cylinderHead = registerPart(
    new THREE.Mesh(new RoundedBoxGeometry(...headSize, 3, 0.04), headMaterial),
    "Cylinder Head"
);
cylinderHead.position.y = 0.92;
engineGroup.add(cylinderHead);
const headWireframe = addWireframe(
    new THREE.BoxGeometry(...headSize),
    cylinderHead.position
);

const boltGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.035, 12);

for (let i = 0; i < 6; i++) {
    const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
    const x = -0.65 + (i % 3) * 0.65;
    const z = i < 3 ? -0.42 : 0.42;
    bolt.position.set(x, 0.2, z);
    cylinderHead.add(bolt);
}


const camshaftGroup = new THREE.Group();

const camshaftMaterial = new THREE.MeshStandardMaterial({
    color: 0x9ba8b5,
    metalness: 0.9,
    roughness: 0.24
});

for (let shaftIndex = 0; shaftIndex < 2; shaftIndex++) {
    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 1.45, 24),
        camshaftMaterial
    );

    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(0, 0, -0.25 + shaftIndex * 0.5);
    camshaftGroup.add(shaft);

    for (let i = 0; i < 4; i++) {
        const lobe = new THREE.Mesh(
            new THREE.SphereGeometry(0.085, 16, 12),
            boltMaterial
        );

        lobe.scale.set(1, 1.5, 0.8);
        lobe.position.set(-0.52 + i * 0.35, 0.035, -0.25 + shaftIndex * 0.5);
        camshaftGroup.add(lobe);
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
    roughness: 0.3
});

for (let i = 0; i < 4; i++) {
    for (let v = 0; v < 2; v++) {
        const x = -0.52 + i * 0.35;
        const z = -0.22 + v * 0.44;

        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.018, 0.22, 12),
            valveMaterial
        );

        stem.position.set(x, 0.91, z);
        valveGroup.add(stem);

        const valveHead = new THREE.Mesh(
            new THREE.CylinderGeometry(0.055, 0.04, 0.025, 20),
            valveMaterial
        );

        valveHead.position.set(x, 0.79, z);
        valveGroup.add(valveHead);

        const spring = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.045, 0.09, 16, 1, true),
            springMaterial
        );

        spring.position.set(x, 1.02, z);
        valveGroup.add(spring);
    }
}

engineGroup.add(valveGroup);


const intakeGroup = new THREE.Group();

const intakeMaterial = new THREE.MeshStandardMaterial({
    color: 0x168da5,
    metalness: 0.75,
    roughness: 0.28
});

const intakePlenum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 1.25, 24),
    intakeMaterial
);

intakePlenum.rotation.z = Math.PI / 2;
intakePlenum.position.set(0, 0.45, 0.82);
intakeGroup.add(intakePlenum);

for (let i = 0; i < 4; i++) {
    const runner = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.075, 0.42, 16),
        intakeMaterial
    );

    runner.position.set(-0.48 + i * 0.32, 0.2, 0.65);
    runner.rotation.x = -0.25;
    intakeGroup.add(runner);
}

engineGroup.add(intakeGroup);

const exhaustManifoldGroup = new THREE.Group();

const exhaustManifoldMaterial = new THREE.MeshStandardMaterial({
    color: 0xb85c32,
    metalness: 0.8,
    roughness: 0.3
});

for (let i = 0; i < 4; i++) {
    const runner = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.055, 0.65, 16),
        exhaustMaterial
    );

    runner.position.set(-0.48 + i * 0.32, 0.05, -0.72);
    runner.rotation.z = (i - 1.5) * 0.16;
    exhaustManifoldGroup.add(runner);
}

const exhaustCollector = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.13, 0.48, 20),
    exhaustMaterial
);

exhaustCollector.rotation.x = Math.PI / 2;
exhaustCollector.position.set(0, -0.12, -1.05);
exhaustManifoldGroup.add(exhaustCollector);

engineGroup.add(exhaustManifoldGroup);

const turboGroup = new THREE.Group();

const turboHousingMaterial = new THREE.MeshStandardMaterial({
    color: 0x8998a5,
    metalness: 0.9,
    roughness: 0.24
});
// turbo 
const turbineHousing = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.09, 16, 32),
    turboHousingMaterial
);

turbineHousing.position.set(0.65, -0.05, -1.1);
turboGroup.add(turbineHousing);

const compressorHousing = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.075, 16, 32),
    turboHousingMaterial
);

compressorHousing.position.set(0.65, -0.05, -0.78);
turboGroup.add(compressorHousing);

const turboShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.38, 20),
    boltMaterial
);

turboShaft.rotation.x = Math.PI / 2;
turboShaft.position.set(0.65, -0.05, -0.94);
turboGroup.add(turboShaft);

const turboInletMaterial = new THREE.MeshStandardMaterial({
    color: 0x8998a5,
    metalness: 0.92,
    roughness: 0.2
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

const turboOutletMaterial = new THREE.MeshStandardMaterial({
    color: 0x168da5,
    metalness: 0.75,
    roughness: 0.28
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
    color: 0x48e5ff,
    transparent: true,
    opacity: 0.85
});

const boostParticleGeometry = new THREE.SphereGeometry(0.025, 12, 12);

for (let i = 0; i < 12; i++) {
    const particle = new THREE.Mesh(
        boostParticleGeometry,
        boostParticleMaterial
    );

    particle.position.set(
        0.65 + Math.sin(i * 2.4) * 0.045,
        0.12 + Math.cos(i * 1.7) * 0.045,
        -0.72 + i * 0.035
    );

    boostFlowGroup.add(particle);
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

for (let i = 0; i < 8; i++) {
    const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.15, 0.018),
        compressorBladeMaterial
    );

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
    roughness: 0.28
});

const turbineHub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.045, 24),
    turboHousingMaterial
);

turbineHub.rotation.x = Math.PI / 2;
turbineWheel.add(turbineHub);

for (let i = 0; i < 8; i++) {
    const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.15, 0.018),
        turbineBladeMaterial
    );

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
const cylinderParts = [];
const cylinderMaterials = [];

for (let i = 0; i < 4; i++) {
    const material = cylinderMaterialTemplate.clone();
    const cylinder = registerPart(
        new THREE.Mesh(cylinderGeometry, material),
        "Cylinder"
    );
    cylinder.position.set(-0.57 + i * 0.38, 0.38, 0.48);
    engineGroup.add(cylinder);
    cylinderParts.push(cylinder);
    cylinderMaterials.push(material);
}


const crankshaftGroup = new THREE.Group();
const crankshaftMaterial = new THREE.MeshStandardMaterial({
    color: 0x8c9ba8,
    metalness: 0.9,
    roughness: 0.25
});

const crankshaftMain = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 1.55, 24),
    crankshaftMaterial
);

crankshaftMain.rotation.z = Math.PI / 2;
crankshaftGroup.add(crankshaftMain);

for (let i = 0; i < 4; i++) {
    const crankPin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.24, 20),
        crankshaftMaterial
    );

    crankPin.rotation.z = Math.PI / 2;
    crankPin.position.set(-0.54 + i * 0.36, -0.18, 0);
    crankshaftGroup.add(crankPin);
}

const connectingRodMaterial = new THREE.MeshStandardMaterial({
    color: 0xd97732,
    metalness: 0.75,
    roughness: 0.3
});

for (let i = 0; i < 4; i++) {
    const rod = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.42, 0.07),
        connectingRodMaterial
    );

    rod.position.set(-0.54 + i * 0.36, 0.12, 0);
    crankshaftGroup.add(rod);
}

const pistonMaterial = new THREE.MeshStandardMaterial({
    color: 0xc4ccd3,
    metalness: 0.85,
    roughness: 0.22
});

const pistonGeometry = new THREE.CylinderGeometry(0.145, 0.145, 0.22, 32);

for (let i = 0; i < 4; i++) {
    const piston = new THREE.Mesh(pistonGeometry, pistonMaterial);

    piston.position.set(-0.54 + i * 0.36, 0.38, 0);
    crankshaftGroup.add(piston);

    for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.148, 0.009, 8, 32),
            boltMaterial
        );

        ring.rotation.x = Math.PI / 2;
        ring.position.set(
            -0.54 + i * 0.36,
            0.45 + ringIndex * 0.055,
            0
        );

        crankshaftGroup.add(ring);
    }
}



crankshaftGroup.position.y = -0.25;
engineGroup.add(crankshaftGroup);


const oilPanSize = [1.35, 0.38, 1.0];
const oilPan = registerPart(
    new THREE.Mesh(new RoundedBoxGeometry(...oilPanSize, 3, 0.04), oilPanMaterial),
    "Oil Pan"
);
oilPan.position.set(0, -0.85, 0);
engineGroup.add(oilPan);
const oilPanWireframe = addWireframe(
    new THREE.BoxGeometry(...oilPanSize),
    oilPan.position
);

const sideBoltGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12);

for (let i = 0; i < 3; i++) {
    const sideBolt = new THREE.Mesh(sideBoltGeometry, boltMaterial);
    sideBolt.rotation.x = Math.PI / 2;
    sideBolt.position.set(-0.48 + i * 0.48, 0, 0.53);
    oilPan.add(sideBolt);
}

const exhaustGeometry = new THREE.CylinderGeometry(0.075, 0.095, 0.7, 16);
const exhaustParts = [];

for (let i = 0; i < 4; i++) {
    const exhaustPipe = registerPart(
        new THREE.Mesh(exhaustGeometry, exhaustMaterial),
        "Exhaust Pipe"
    );
    exhaustPipe.position.set(-0.57 + i * 0.38, -0.05, -0.68);
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

const floorGroup = new THREE.Group();
floorGroup.position.y = FLOOR_Y;
scene.add(floorGroup);

const grid = new THREE.GridHelper(24, 48, COLORS.cyan, "#12384f");
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.material.toneMapped = false;
floorGroup.add(grid);

function makeGlowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(0, 229, 255, 0.22)");
    gradient.addColorStop(1, "rgba(0, 229, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
}

const glowPool = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
        map: makeGlowTexture(),
        transparent: true,
        depthWrite: false,
        toneMapped: false
    })
);
glowPool.position.y = 0.004;
floorGroup.add(glowPool);

const ringMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.cyan,
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

scene.add(new THREE.AmbientLight("#ffffff", 0.3));

const keyLight = new THREE.DirectionalLight("#ffffff", 2.2);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);

const cyanLight = new THREE.PointLight(COLORS.cyan, 20, 10);
cyanLight.position.set(-3, 1, 2);
scene.add(cyanLight);

const orangeLight = new THREE.PointLight(COLORS.orange, 14, 10);
orangeLight.position.set(3, -1, -2);
scene.add(orangeLight);

const movableParts = [
    {
        object: cylinderHead,
        wireframe: headWireframe,
        offset: new THREE.Vector3(0, 1.1, 0)
    },
    {
        object: oilPan,
        wireframe: oilPanWireframe,
        offset: new THREE.Vector3(0, -0.7, 0)
    },
    {
        object: pulleyGroup,
        offset: new THREE.Vector3(0.8, 0, 0)
    },
    ...cylinderParts.map((object, index) => ({
        object,
        offset: new THREE.Vector3(0, 0.65, index % 2 === 0 ? 0.35 : -0.35)
    })),
    ...exhaustParts.map((object, index) => ({
        object,
        offset: new THREE.Vector3(0, -0.15, index % 2 === 0 ? -1.0 : -1.35)
    }))
];

for (const part of movableParts) {
    part.start = part.object.position.clone();
    part.destination = part.start.clone();
}

const sim = {
    running: true,
    rpm: 0,
    temp: 40,
    boost: 0,
    crankDeg: 0
};

let hologramEnabled = true;
let exploded = false;
let lastTime = 0;
let telemetryClock = 0;

function approach(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function updateSimulation(time, dt) {
    const targetRpm = sim.running
        ? Math.max(800,
            3200 + Math.sin(time * 0.0012) * 2200 + Math.sin(time * 0.0031) * 500)
        : 0;
    const targetTemp = sim.running ? 88 + Math.sin(time * 0.00045) * 5 : 35;
    const targetBoost = sim.running
        ? Math.max(0.1, 0.8 + Math.sin(time * 0.0015) * 0.65)
        : 0;

    sim.rpm = approach(sim.rpm, targetRpm, 3, dt);
    sim.temp = approach(sim.temp, targetTemp, 0.15, dt);
    sim.boost = approach(sim.boost, targetBoost, 2, dt);

    sim.crankDeg = (sim.crankDeg + (sim.rpm * 6 / SLOW_MOTION) * dt) % 720;
}

function updateEngineVisuals(time) {
    const crank = sim.crankDeg;
    const idleFade = Math.min(sim.rpm / 800, 1);

    cylinderMaterials.forEach((material, i) => {
        const phase = (((crank - FIRING_OFFSETS[i]) % 720) + 720) % 720 / 720;
        const burn = phase < 0.25 ? 1 - phase / 0.25 : 0;
        material.emissiveIntensity = burn * burn * 2.2 * idleFade;
    });

    pulleySpinner.rotation.x = THREE.MathUtils.degToRad(crank);

    if (prefersReducedMotion) return;

    const load = sim.rpm / MAX_RPM;
    engineGroup.position.x = Math.cos(time * 0.057) * SHAKE_AMOUNT * load;
    engineGroup.position.y = Math.sin(time * 0.045) * SHAKE_AMOUNT * load;

    const pulse = (time % 3000) / 3000;
    pulseRing.scale.setScalar(0.3 + pulse * 0.7);
    pulseRing.material.opacity = (1 - pulse) * 0.5;

    scanGroup.position.y = 0.05 + Math.sin(time * 0.0008) * 1.0;
}

function updateExplodedView(dt) {
    const k = 1 - Math.exp(-6 * dt);

    movableParts.forEach((part) => {
        part.object.position.lerp(part.destination, k);

        if (part.wireframe) {
            part.wireframe.position.copy(part.object.position);
        }
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

    if (ui.rpmBar) ui.rpmBar.style.width = `${Math.min(rpm / MAX_RPM, 1) * 100}%`;
    if (ui.tempBar) ui.tempBar.style.width = `${Math.min(temperature / 130, 1) * 100}%`;
    if (ui.boostBar) ui.boostBar.style.width = `${Math.min(sim.boost / 2, 1) * 100}%`;

    if (ui.gaugeText) ui.gaugeText.textContent = rpm;

    if (ui.gaugePath) {

        const progress = Math.min(rpm / MAX_RPM, 1);
        ui.gaugePath.style.strokeDasharray = `${GAUGE_ARC}`;
        ui.gaugePath.style.strokeDashoffset = `${GAUGE_ARC * (1 - progress)}`;
    }
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedPart = null;

const selectionOutline = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
        color: COLORS.orange,
        depthTest: false,
        toneMapped: false
    })
);
selectionOutline.renderOrder = 10;

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
    selectionOutline.removeFromParent();
    selectionOutline.geometry.dispose();
    selectedPart = mesh;

    if (mesh) {
        mesh.geometry.computeBoundingBox();
        const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
        const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());

        selectionOutline.geometry = new THREE.EdgesGeometry(
            new THREE.BoxGeometry(size.x, size.y, size.z)
        );
        selectionOutline.position.copy(center);
        selectionOutline.scale.setScalar(1.08);
        mesh.add(selectionOutline);
    }

    showPartInfo(mesh ? mesh.userData.partName : null);
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
    renderer.domElement.style.cursor = pickPart() ? "pointer" : "grab";
});

showPartInfo(null);

ui.reset?.addEventListener("click", () => {
    camera.position.copy(cameraStart);
    controls.target.copy(targetStart);
    controls.update();
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

function animate(time) {

    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    controls.update();
    updateSimulation(time, dt);
    updateEngineVisuals(time);
    updateExplodedView(dt);
    renderTelemetry(dt);
    compressorWheel.rotation.z += dt * 8;
    turbineWheel.rotation.z -= dt * 8;

    boostFlowGroup.children.forEach((particle, i) => {
    particle.position.z += dt * 0.8;

    if (particle.position.z > -0.25) {
        particle.position.z = -0.72;
    }
});

    renderer.render(scene, camera);
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
startLoop();