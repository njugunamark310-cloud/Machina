export const KB = [
  {
    keys: ['white smoke', 'white exhaust'],
    text: `White smoke from a diesel: (1) Brief white smoke on a cold start that clears within a minute or two is often normal condensation and cold-combustion vapor. (2) Persistent white smoke after warm-up, with sweet-smelling exhaust, falling coolant level or bubbles in the radiator, points to coolant entering the combustion chamber: head gasket, cracked head or liner. (3) White smoke with raw diesel smell and rough running points to unburned fuel: faulty glow plugs or glow plug relay, an injector fault, incorrect injection timing, or low compression in a cylinder. Check coolant level and condition first, then glow plugs, then a compression test.`
  },
  {
    keys: ['p0299', 'p0234', 'underboost', 'overboost code'],
    text: `P0299 is "Turbo/Supercharger Underboost Condition": actual boost pressure is lower than the ECU's target. Common causes: boost leaks (split hoses, loose clamps, intercooler or its pipes), a stuck-open wastegate or faulty VGT vane actuator, a worn or damaged turbo, an exhaust leak before the turbine, or a faulty boost/MAP sensor. P0234 is the opposite: overboost.`
  },
  {
    keys: ['limited slip', 'limited-slip', 'lsd', 'torsen', 'differential'],
    text: `An open differential sends equal torque to both wheels on an axle, so if one wheel loses grip the torque available drops to what that wheel can carry. A limited-slip differential (LSD) limits the speed difference between the two wheels so the wheel with more grip can still drive. Types: clutch-pack (preloaded friction plates), helical/Torsen (gear friction), and viscous (fluid shear). A torque converter is not part of a differential.`
  },
  {
    keys: ['dsg', 'dual clutch', 'dual-clutch', 'dct', 'wet clutch', 'dry clutch'],
    text: `A DSG (dual-clutch transmission) has two clutches and two input shafts. One clutch drives the odd gears (1, 3, 5, 7) and the other drives the even gears (2, 4, 6) and reverse. The next gear is pre-selected on the idle shaft, so a shift is one clutch releasing while the other engages, with almost no break in torque. Wet DSG (e.g. VW DQ250, DQ381, DQ500): multi-plate clutches run in oil, which cools them and handles higher torque. Dry DSG (e.g. VW DQ200): dry single-plate clutches, lighter and more efficient but lower torque capacity and more heat-sensitive in stop-start traffic. A conventional automatic differs: it uses a torque converter and planetary gearsets.`
  },
  {
    keys: ['torque converter', 'automatic transmission', 'planetary'],
    text: `A conventional automatic uses a fluid torque converter between engine and gearbox, and planetary gearsets whose elements are held or released by clutches and brake bands to select ratios. The converter allows slip at idle and multiplies torque at low speed; many have a lock-up clutch to remove slip at cruising speed.`
  },
  {
    keys: ['wastegate', 'boost control', 'overboost'],
    text: `A turbo wastegate diverts exhaust gas around the turbine to limit turbine speed and boost pressure. A stuck-closed wastegate can cause overboost; stuck-open can cause low boost.`
  }
];

export function lookup(text) {
  const q = text.toLowerCase();
  return KB.filter(e => e.keys.some(k => q.includes(k)))
    .slice(0, 2).map(e => e.text).join('\n\n');
}
