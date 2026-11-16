# Shellworks

A browser ballistics-lab game for phones and desktops. Design your own shell or rocket, fire it at a pixel fortress, and destroy the red core for the **lowest total cost**.

## Play

Open `index.html` through any static web server, or publish it with GitHub Pages (see below). There is no build step and nothing to install.

## How it plays

- **Shape**: drag Bezier points and handles to draw the outline. The game spins the outline into a solid and works out volume, mass, centre of mass, drag and centre of pressure from it.
- **Payload**:
  - **Solid shot**: kinetic penetrator with a jacket and a core (steel, tungsten, DU…).
  - **AP-HE**: penetrates, then bursts after a fuse delay.
  - **HE**: blast and fragments.
  - **HEAT**: shaped-charge jet.
- **Launch**:
  - **Cannon**: set propellant charge and gun bore. A bore wider than the shell adds a sabot. Rifling spins short shells stable; long ones need fins.
  - **Rocket**: thrust and burn time come from the motor length. Rockets need fins to fly straight.
- **Campaign**: 12 stages. Each stage has a shot limit, and your total spend earns 1–3 stars.
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
