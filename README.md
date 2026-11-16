# Shellworks

A browser ballistics-lab game for phones and desktops. Design your own shell or rocket, fire it at a pixel fortress, and destroy the red core for the **lowest total cost**.

## Play

Open `index.html` through any static web server, or publish it with GitHub Pages (see below). There is no build step and nothing to install.

## How it plays

- **Shape**: drag Bezier points and handles to draw the outline. The game spins the outline into a solid and works out volume, mass, centre of mass, drag and centre of pressure from it.
- **Inside (layers)**: stack any layers inside the body. Each layer has its own start/end position and inner/outer radius:
  - **Penetrator core** of any metal (steel, tungsten, DU…). A soft body peels off on hard armour and the core carries on alone.
  - **Explosive**, set off by the fuse: **Impact** (HE), **Delay** (burrows in, then bursts) or **Squash** (HESH, knocks a scab off the back of a plate).
  - **Shaped charge**: a jet. Two of them make a tandem charge, where the front one clears reactive tiles.
  - **Hollow** space, for stand-off or to save weight.
  - **Rocket fuel**: makes a rocket, or a rocket-assisted cannon shell.
- **Limits**: at least 20 mm diameter, L/D ≤ 30, no pinched waist, and at least 3 mm of casing around soft fillings. The shell must also survive its own launch acceleration, and the gun can't push past about 1,850 m/s.
- **Launch**:
  - **Artillery gun**: set propellant charge and gun bore. A bore wider than the shell adds a sabot. Rifling spins short shells stable; long ones need fins.
  - **Rocket rail**: thrust and burn time come from the fuel layers. Rockets need fins to fly straight.
- **Aim**: lay the howitzer yourself. Drag up/down, use ± with 1° / 0.1° / 0.01° steps, or the arrow keys. A small window shows where an ideal shot would land. Fire with the FIRE button, Space or Enter.
- **Slow motion**: the camera follows the shell into the target in slow motion. You see the body peel, molten metal and red-hot hole edges, then a shot report lists every layer it went through.
- **Campaign**: 12 stages. You get at most **5 shells** per stage, and you can swap shells between shots from the rack. Your total spend earns 1–3 stars.
- **Sandbox**: unlimited shots, any target, any range, and a material paint brush.
- **Share**: in Workshop → Saved, copy a share code. A friend can import it and try to beat your price.

## Physics model (simplified but grounded)

- **Flight**: gravity, Mach-dependent drag (nose wave drag, base drag with boattail, skin friction, fins), and rocket thrust with mass burn-off. Unstable shells yaw, which adds drag and makes them drift.
- **Stability**:
  - Spin-stabilised rounds use a gyroscopic factor based on L/D.
  - Finned rounds and rockets use a Barrowman-style static margin (centre of pressure behind centre of mass).
- **Penetration**:
  - Energy is spent per cell, based on target resistance, projectile cross-section and nose shape.
  - Long rods erode Tate-style, so penetration depends on velocity, density and hardness ratios.
  - Ricochet depends on obliquity and nose shape.
  - A soft jacket strips off when it hits hard armour.
  - Spall is thrown off when the penetrator exits armour.
- **HEAT**: jet penetration scales with liner diameter, explosive power and stand-off. The jet decays across air gaps. Reactive tiles and ceramic are very effective against it.
- **Blast**: rays cast with occlusion and attenuation per material. Casing fragments use Gurney velocity.

## Performance

- Destruction runs on a 240×120 cell grid that is drawn as a single scaled image. Only changed cells are redrawn.
- Particles live in a fixed-size typed-array pool and are drawn in batches. The pool reuses old particles instead of growing, so explosions never allocate memory.
- In Auto mode, the graphics setting lowers resolution and the particle budget if the frame rate drops.

## Publish on GitHub Pages

1. Merge this branch into `main`.
2. Open repository **Settings → Pages**.
3. Choose **Deploy from a branch**, then `main` and `/ (root)`.
4. The game will be at `https://<user>.github.io/<repo>/`.

## Dev tools

These need Node 18 or newer:

- `node tools/balance.js`: fires the templates at every stage.
- `node tools/optimize.js <stage> <ms>`: random search for the cheapest winning shell. It was used to set the star thresholds.
