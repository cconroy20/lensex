# Lensing Explorer

An interactive page on gravitational lensing. Drag a background source behind a lens and watch two linked views
respond:

- **Source plane**: the source at the true position, with the caustics (and, for singular isothermal lenses, the cut).
- **Sky**: the lensed image, drawn by tracing each sky pixel back to the source plane, with the critical curves and
  markers on the images of the source center (circle = minimum, diamond = saddle, triangle = maximum).
An on/off switch and a Blink button flip both panels between the smooth lens and the lens with subhalos. Hovering
an image marker gives the type, signed magnification and delay of the image and, with subhalos, the smooth-lens
magnification, the flux change and the shift of the same image. The page opens on a point source seen at 0.05″
resolution, so magnification shows as brightness from the start.

Layout: the two panels side by side as equal squares, the controls in a strip of four boxes beneath (Lens, Subhalos,
Source, Display). The canvas size is set by the window height and the page width by the canvas size, so the
controls stay on screen without scrolling (checked at 1440 × 900 and 1280 × 800; the canvases are 535 and 435 px).
Earlier versions had a third panel (a subhalo magnification-ratio map, an image difference, and the arrival-time
surface) and an Images table; both were removed at Charlie's request on 2026-10-16.

Lens models: point mass, singular isothermal sphere (SIS), cored isothermal sphere, and an isothermal ellipsoid (with
optional core) plus external shear, any of them with up to 20 dark-matter subhalos of equal mass (10⁶–10¹⁰ M☉), placed
at random near the Einstein ring and draggable in the sky panel. With subhalos the image tooltips give each image's
magnification for the smooth lens and with the clumps, and how far the clumps move the image (mas), so flux-ratio
anomalies can be read off directly; the sky panel zooms (scroll) to
show the milliarcsecond structure a clump imprints on an image. Source shapes: a point source (a quasar), a uniform disk (shows surface-brightness conservation
most clearly), and a galaxy with three bright knots; the disk and the galaxy take an inclination from face-on (0°) to
edge-on (90°), with projected axis ratio √(cos² i + 0.01 sin² i) (an intrinsic thickness of 0.1).
Draggable objects brighten under the pointer and show a grab cursor, without a caption: the source in the source
plane (grabbed and moved from where it was taken hold of; a press elsewhere moves the source to the pointer) and
the subhalos in the sky panel, where they live (they are in the lens plane, so they have no place in the source
plane).
A telescope-resolution slider blurs the sky with a Gaussian point-spread function (perfect to 1″ FWHM).

## Physics and assumptions

- **Units**: angles in units of the Einstein radius θ_E; arrival time in units of
  T_* = (1 + z_l) D_l D_s / (c D_ls) θ_E². Delays are quoted for θ_E = 1″, z_l = 0.5, z_s = 2 and the Planck 2018
  cosmology (astropy `Planck18`): T_* = 86.06 days. With these numbers a point mass has 2.52 × 10¹¹ M☉, an SIS a
  velocity dispersion of 234 km s⁻¹, Σ_crit = 0.42 g cm⁻² (2020 M☉ pc⁻²), and 1″ = 6.29 kpc at the lens.
- **Point mass**: ψ = ln r.
- **Isothermal ellipsoid** (Keeton & Kochanek 1998, as written in Keeton 2001, arXiv:astro-ph/0102341, Sect. 3,
  α = 1; source in `rawdata/keeton2001/catalog.tex`): κ = (b/2)/√(s² + ξ²), ξ² = x² + y²/q² along the major axis,
  closed-form deflection (atan/atanh) and potential, normalized so that ψ(0) = 0. The normalization is b = 1/√q, so
  the singular model has κ = 1/(2√(q x² + y²/q)) (the "intermediate-axis" convention, as in lenstronomy's SIE) and an
  Einstein radius near 1 at any axis ratio. q = 1, s = 0 is the SIS; q = 1, s > 0 is the "Cored" model.
- **Hessian**: analytic, derived here by differentiating Keeton's deflection:
  ψ_xx = bq(q²s² + y² + sψ̃)/(ψ̃ D), ψ_yy = bq(s² + x² + sψ̃)/(ψ̃ D), ψ_xy = −bqxy/(ψ̃ D), with
  ψ̃² = q²(s² + x²) + y² and D = (ψ̃ + s)² + (1 − q²)x². The trace equals 2κ to rounding.
- **External shear**: ψ = [γ₁(x² − y²) + 2γ₂xy]/2 with (γ₁, γ₂) = γ(cos 2φ, sin 2φ).
- **Subhalos**: pseudo-Jaffe clumps as in Dalal & Kochanek (2002, arXiv:astro-ph/0111456, Sect. 3; source in
  `rawdata/dalal2002/ms.tex`): κ = (b/2)[1/r − 1/√(r² + a²)], total mass M = π b a Σ_crit, tidally truncated at
  a = √(b b₀) with b₀ = θ_E (their text, after Metcalf & Madau 2001). In θ_E units M/M_E = b^{3/2}, with
  M_E = π Σ_crit θ_E² = 2.52 × 10¹¹ M☉ the mass inside the Einstein radius; a 10⁹ M☉ clump has b = 0.025 θ_E
  (25 mas) and a = 0.16 θ_E. Deflection α_r = b[1 − r/(R_a + a)], R_a = √(r² + a²); potential
  ψ = b[r − r²/(R_a + a) + a ln((a + R_a)/(2a))] (the SIS minus the cored isothermal sphere of Keeton 2001, written
  to avoid the cancellation in R_a − a). Positions are area-uniform in the annulus 0.5–1.5 θ_E. Each clump center is
  singular, so each clump has a cut, like the SIS. Line-of-sight halos at other redshifts are not modeled.
- **Images**: the image plane is covered by a polar grid (200 radii log-spaced from 10⁻³ to 6, 256 angles), plus a
  finer polar grid around each subhalo (90 radii from 0.02 b to max(2a, 12b), clipped to 0.08–0.8 θ_E, 120 angles),
  whose images and critical curves are far smaller than the main cells; each grid triangle is mapped through the lens
  equation, triangles containing the source yield a starting point, and Newton's
  method on the lens equation refines it to a residual below 10⁻⁹. Type from the Hessian of τ: det A < 0 saddle,
  det A > 0 with positive trace minimum, negative trace maximum. μ = 1/det A.
- **Critical curves and caustics**: marching squares for det A = 0 on the same polar grid, mapped through the lens
  equation. For a singular isothermal center the deflection stays finite and depends on direction as θ → 0, so the
  center maps onto a closed curve in the source plane, the cut; crossing the cut adds or removes one image.
- **Extended source**: each sky pixel is traced to the source plane and takes the surface brightness there, so the
  rendering conserves surface brightness by construction. The extended-source flux magnification is the sum of the
  lensed sky over the sum of the unlensed source on the same pixel grid (sources reaching beyond the ±2.5 θ_E sky
  field are undercounted).
- **Telescope view**: the sky is blurred with a Gaussian PSF of the chosen FWHM (arcsec = θ_E): k × k block
  averaging (k = ⌊σ/3 px⌋) and then a separable Gaussian, which conserves the light apart from light leaving the
  field. A point source is drawn as one PSF per image with flux |μ| from the image finder (exact; minimum FWHM
  0.01″). The display scale is fixed by the brightest point of the smooth lens's blurred sky (with 25% headroom), so
  switching the subhalos on and off compares like with like. Default: a point source at 0.05″.
- **Color scale**: one ramp (navy → brown → orange → amber → cream), labeled by a colorbar in the sky panel header (decimal ticks, title "brightness", or "surface brightness" with a perfect telescope; the normalization is in the hover text).
  The stretch is logarithmic over three decades by default (a Lin | Log switch beside the colorbar); the source
  plane uses the same stretch. Perfect telescope: surface brightness with the source peak = 1, the same scale in both
  panels, so a lensed image visibly keeps the source's colors. Blurred or point source: 1 = the brightest image of
  the smooth lens, top of scale 1.25. The log stretch brings up the demagnified central image of the default cored
  lens (|μ| = 0.09, ramp position 0.37), which the linear stretch leaves at 0.01.
- **Left out**: multiple lens planes, microlensing by stars in the lens galaxy, finite-source effects on the point
  magnifications in the tooltips, and the light-curve and weak-lensing views (planned second stage).

## Verification

`node validate.js` (56 checks, all pass):

- Point mass: image positions (u ± √(u² + 4))/2, magnifications, signed magnifications summing to 1, total equal to
  Paczyński's A(u), unit-circle critical curve, caustic collapsed to the origin; all to ~10⁻¹⁴.
- SIS: images at u ± 1, magnifications (1 + u)/u and −(1 − u)/u, delay 2u T_*, one image for u > 1, cut = unit circle.
- Isothermal ellipsoid (5 parameter sets including core, shear and q → 1): deflection = ∇ψ, analytic Hessian =
  ∇(deflection), curl-free, ∇·α = 2κ, all by finite differences; ψ(0) = 0; κ normalization.
- Image counts for 6000 random sources over four lenses (cored sphere, SIE + shear, cored SIE + shear, point mass +
  shear): count = 1 (point mass: 2) + 2 per enclosing caustic + 1 inside the cut, with zero mismatches away from the
  caustics; odd counts for non-singular lenses; first arrival always a minimum; types consistent with the Hessian.
- Subhalos: far field of a clump is a point mass with θ_E² = b a; ψ = 0 at the clump center; b and a for 10⁹ M☉;
  deflection = ∇ψ, Hessian = ∇α, curl-free and trace = 2κ for three composite lenses. Image finding against an
  independent brute-force search (uniform Cartesian triangle grid, spacing 0.0033, 2.6 million triangles per lens)
  for four lenses with clumps, 112 sources including sources whose smooth-lens image falls on a clump: 395 images,
  up to 7 per source, none missed (the brute force misses 4 that the fine grids find, all next to a clump center).
- **lenstronomy 1.14.2** (`crosscheck.py` writes `cache/lenstronomy_cases.json`): 9 lenses (2 with subhalos, built as
  SIS + NIE(−b, s = a) per clump), 141 sources, 332 images found by lenstronomy's own solver, all found here;
  positions to 6 × 10⁻⁸; relative delays to 9 × 10⁻⁹; deflection of the cored ellipsoid + shear identical to
  3 × 10⁻¹⁶; T_* recomputed with astropy agrees. Two further images found here (|μ| = 0.011 and 0.048, 0.002 θ_E from
  a clump center, residual 10⁻¹⁵) lie inside lenstronomy's search spacing (`min_distance` 0.001) around a singular
  center.

`node uitest.js` drives the page in headless Chrome (76 checks): source dragging, the four models and their sliders,
source shapes and inclination (edge-on area 0.103 of face-on against 0.1), hover highlights and grab-dragging of the source and the clumps, display toggles, hover tooltips on each image marker (with the smooth-lens comparison), the
subhalo controls (adding clumps, dragging a clump next to a saddle image: μ −1.24 against −2.37 smooth, reshuffle,
sky zoom, clump positions in the URL hash), the on/off switch and Blink, the layout (two equal square canvases,
controls inside the window at 1440 × 900 and 1280 × 800 for the round and elliptical lenses), the telescope view (a point-source image's light changes by the |μ| ratio
when the clumps are switched on: 0.522 against 0.521; blurring conserves an extended source's light to 10⁻⁴), URL-hash round trip, reset, the phone-width layout, and frame times
(7–11 ms per source drag at 1440 px, dpr 1). A lens rebuild with caustics and images (the work done on each step of
a clump drag) takes 15 ms with 6 clumps and 40 ms with 20 (measured in node).

## Things worth knowing (found while building this)

1. **Two different "cored isothermal" models exist.** Softening the potential, ψ = b(√(r² + s²) − s), gives
   α = br/√(r² + s²); softening the density (Keeton's model, used here) gives α = b(√(r² + s²) − s)/r. Keeton's
   elliptical potential is correct for the second; checked against the first, the potential looks wrong.
2. **lenstronomy's NIE Hessian is a one-sided finite difference** of the analytic deflection (`NIEMajorAxis.hessian`,
   step `self._diff`), so its κ and magnifications carry ~10⁻⁶ errors. lenstronomy also regularizes: its "singular"
   SIE has a 10⁻¹⁰ core, and round lenses meet an ellipticity floor, which shift deflections by ≲ 10⁻⁸. The
   cored ellipsoid with q < 1 has neither, and there the two codes agree to rounding.
3. **The radial caustic of the cored sphere grows as the core shrinks**: radius 0.24 θ_E at s = 0.2, 0.43 at s = 0.1,
   0.57 at s = 0.05, approaching the SIS cut (1) as s → 0. The default (s = 0.1, source at 0.22) sits inside it, so
   the page opens on the minimum–saddle–maximum triplet.
4. **A point mass always has two images**, so the image-count rule starts at 2 there: the singular point never
   swallows the inner image, which only fades as the source moves out.
5. **A clump's singular center can hold a faint inner image of its own.** When the source lies inside a clump's cut,
   the clump keeps a demagnified image very close to its center (|μ| ~ 0.01–0.05, 0.002 θ_E away in the
   cross-check). lenstronomy's solver, run here with `min_distance` = 0.001, steps over these.
6. **The flux-ratio anomaly in one example**: in the ellipse + shear quad, a 10⁹ M☉ clump placed 0.04 θ_E outside
   the brightest saddle image changes the saddle's magnification from −2.37 (smooth lens) to −1.24 (uitest.js).
7. **Flux changes far more than position, and the sign depends on geometry.** For a 10⁸ M☉ clump (b = 5.4 mas)
   0.05 θ_E from an image of the default quad, the image moves 3–4 mas while the flux changes by 15–23%. With the
   clump on the radial line through the image (inside or outside), minima brighten (×1.20–1.23) and saddles dim
   (×0.82–0.88); with the clump beside the image along the arc, saddles brighten (×1.16–1.20) and minima barely change
   (×0.99–1.00). The clump stretches images across the line joining the two; a radial clump adds to the stretch along
   the arc, which pushes a minimum toward the critical curve and a saddle away from the curve. At 0.02 θ_E a 10⁸ M☉
   clump doubles a minimum (×2.06) and takes a saddle to ×0.65, with 4–5 mas shifts.
8. **Comparing magnifications at a fixed sky position misleads near a critical curve** (found with the removed
   magnification-ratio map): the combined mass of the clumps (2.4% of the mass inside θ_E for six 10⁹ M☉ clumps)
   shifts the critical curve slightly, so the ratio swings sharply in a rim along the curve, while the images
   there move with the curve. The image tooltips compare matched images, which is the reliable measure.
9. **On the perfect sky the magnification is invisible as brightness.** Surface brightness is conserved, so a flux
   change shows only as a change of image area. And a source larger than a clump's footprint averages over the
   footprint: image 3's flux change with a clump 0.04 θ_E outside the image is ×0.78 for a point source but ×0.97
   for a disk of radius 0.05 θ_E and ×0.99 for 0.1 θ_E (10⁸ M☉); ×0.48 point, ×0.69 and ×0.93 (10⁹ M☉). Hence the
   Point source and the telescope view, in which an unresolved image's peak brightness tracks its flux.

## Running and deploying

- Dev server: `python3 web/serve.py 8791`, then http://localhost:8791/ (serve.py stamps the scripts with their
  modification times so VS Code's Simple Browser cannot run a stale copy).
- Sources: `./fetch.sh` downloads Keeton (2001) and Dalal & Kochanek (2002) from arXiv into rawdata/.
- Cross-check: `python -m venv venv && venv/bin/pip install lenstronomy astropy && venv/bin/python crosscheck.py`,
  then `node validate.js`.
- Deploy (as for spex, ismex and dustex): create the GitHub repository `cconroy20/lensex`, then
  `git push -u origin main && ./deploy.sh` → https://cconroy20.github.io/lensex/.
