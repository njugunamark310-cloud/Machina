# MACHINA
### Automotive Engineering & Simulation Platform

> Explore the mechanics. Understand the engineering. Experience the machine.

MACHINA is an interactive automotive engineering platform designed to bring complex vehicle systems to life through 3D visualization, mechanical simulation, real-time telemetry and AI-assisted engineering explanations.

Built around an immersive engineering workstation, MACHINA allows users to explore how engines and transmissions operate, experiment with simulated operating conditions and understand the relationship between individual mechanical components.

---

## Overview

Modern automotive systems combine mechanical engineering, electronics, thermodynamics and software. Understanding how these systems interact can be challenging without practical visualization.

MACHINA aims to bridge that gap by providing an interactive digital laboratory where users can explore automotive systems, manipulate simulation parameters and investigate engineering concepts.

## Core Modules

### 01. Engine Lab
An interactive 3D turbocharged four-cylinder engine simulation.

- Explore a detailed 3D engine model.
- Rotate and zoom using mouse controls.
- Inspect individual engine components.
- Explore exploded and cutaway views.
- Observe the four-stroke combustion cycle.
- Monitor simulated engine RPM, coolant temperature and boost pressure.
- Adjust engine speed and boost pressure.
- Experience engine audio simulation.

### 02. Gearbox Lab
An interactive dual-clutch transmission (DCT) laboratory.

- Explore an eight-speed DCT model.
- Inspect internal gearbox components.
- Understand clutch and gear engagement.
- Monitor input and output shaft speeds.
- Observe gear ratios and wheel torque.
- Experiment with throttle and braking.
- Explore automatic and sport driving modes.
- Connect gearbox operation to engine simulation.

### 03. Turbo Lab
Explore the principles of forced induction.

- Understand turbocharger operation.
- Explore boost pressure.
- Investigate airflow and turbo lag.
- Understand the relationship between engine load and boost.

### 04. Live Telemetry
A simulated vehicle monitoring interface displaying:

- Engine RPM.
- Vehicle speed.
- Coolant temperature.
- Throttle position.
- Boost pressure.
- Gearbox operating parameters.

### 05. AXIOM — AI Engineering Assistant

AXIOM is MACHINA's experimental automotive engineering intelligence.

It is designed to provide explanations, technical guidance and diagnostic assistance across automotive engineering topics.

Capabilities include:

- Engine operation and mechanical systems.
- Turbocharging and forced induction.
- Transmission and drivetrain engineering.
- Automotive diagnostics.
- Fault investigation and troubleshooting.
- Explanations of mechanical principles.
- Context-aware responses using available simulator readings.

AXIOM supports AI-powered conversational responses through a Cloudflare-hosted AI backend, with a local Ollama-based backend also available in the project.

<sub>AXIOM is experimental. AI-generated information should be independently verified before being used for real-world mechanical decisions.</sub>

---

## Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Application structure |
| CSS3 | Interface and visual design |
| JavaScript (ES Modules) | Application logic and simulation |
| Three.js | Interactive 3D visualization |
| Web Audio API | Engine audio simulation |
| Ollama | Local AI inference |
| Cloudflare Workers | Hosted AXIOM backend |
| Cloudflare Workers AI | Hosted AI inference |

## Getting Started

### Prerequisites

- A modern web browser with WebGL support.
- Node.js for the local backend.
- Ollama for local AI inference (optional when using the hosted AXIOM backend).
- Internet connection for CDN-hosted Three.js dependencies and hosted services.

### Installation

Clone the repository:

```bash
git clone https://github.com/njugunamark310-cloud/Machina.git
```

Navigate into the project:

```bash
cd Machina
```

### Run MACHINA

Start the local development server:

```bash
node server.js
```

Open your browser and visit:

```text
http://localhost:3000
```

### Local AXIOM Setup

To run the local AI backend, install Ollama and download the configured model:

```bash
ollama pull llama3.2:1b
```

Ensure Ollama is running before using the local AXIOM backend.

The hosted AXIOM deployment can be used separately when its endpoint is configured in the frontend.

---

## Controls

### Engine Lab

| Control | Action |
|---|---|
| Mouse drag | Rotate engine |
| Scroll | Zoom |
| Click component | Inspect component |
| RPM slider | Adjust engine speed |
| Boost slider | Adjust boost pressure |
| Engine button | Start/stop simulation |
| Exploded View | Toggle exploded configuration |
| Cutaway | Toggle cutaway view |

### Gearbox Lab

| Key | Action |
|---|---|
| W | Throttle |
| S | Brake |
| P | Park |
| R | Reverse |
| N | Neutral |
| D | Drive |
| G | Toggle sport mode |
| M | Manual mode |
| Q | Shift down |
| E | Shift up |

The gearbox can also be operated using its on-screen controls.

---

## Project Architecture

```text
MACHINA/
│
├── index.html
├── styles.css
├── gearbox.css
│
├── script.js
├── gearbox.js
├── hp.js
├── machina-audio.js
├── axiom.js
│
├── server.js
│
└── cloud-axiom/
    ├── package.json
    └── src/
        ├── index.js
        └── knowledge.js
```

The frontend contains the engineering interface, simulation logic and visualization systems.

The AXIOM backend provides the AI integration, with separate hosted and local inference implementations.

---

## Engineering Disclaimer

MACHINA is an educational and experimental engineering simulation platform.

- All displayed vehicle readings are simulated.
- The 3D models are illustrative representations.
- Mechanical behaviour is simplified for educational purposes.
- Simulations are not substitutes for physical testing or professional engineering validation.
- AXIOM responses are AI-generated and may contain inaccuracies.

MACHINA does not currently represent a certified automotive diagnostic or vehicle-control system.

---

## Development Roadmap

Planned areas of development include:

- [ ] Advanced automotive diagnostics.
- [ ] Expanded OBD-II fault-code exploration.
- [ ] Petrol and diesel powertrain comparisons.
- [ ] Mechanical component exploration.
- [ ] Suspension and braking system simulations.
- [ ] More advanced engine and transmission behaviour.
- [ ] Expanded AXIOM engineering knowledge.
- [ ] Improved simulation accuracy and visualization.

---

## Project Philosophy

MACHINA is built around one central idea:

**Understanding engineering should be an interactive experience.**

Instead of simply reading about how mechanical systems work, users should be able to explore them, manipulate their behaviour and observe how individual components interact.

**MACHINA — Automotive Engineering Systems.**
