"""Independent cross-check of web/physics.js against lenstronomy.

Writes cache/lenstronomy_cases.json, which validate.js reads: deflections, Hessians and
potentials at random points, and the images (positions, magnifications, Fermat
potentials) that lenstronomy's own solver finds for a set of sources, for each model.
Also recomputes the delay scale T_* with astropy.

    python crosscheck.py        (needs lenstronomy; see README)
"""
import json
import os

import numpy as np
from lenstronomy.LensModel.lens_model import LensModel
from lenstronomy.LensModel.Solver.lens_equation_solver import LensEquationSolver
import lenstronomy.Util.param_util as pu

HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)


def lenstronomy_model(spec):
    """Translate a physics.js lens spec into lenstronomy profiles and kwargs."""
    names, kw = [], []
    if spec["model"] == "point":
        names.append("POINT_MASS")
        kw.append(dict(theta_E=1.0, center_x=0.0, center_y=0.0))
    else:
        q, s, pa = spec.get("q", 1.0), spec.get("s", 0.0), spec.get("pa", 0.0)
        e1, e2 = pu.phi_q2_ellipticity(pa, q)
        if s > 0:
            # physics.js: kappa = 1 / (2 sqrt(q s^2 + q x^2 + y^2/q)); lenstronomy NIE:
            # kappa = theta_E / (2 sqrt(q x^2 + y^2/q + s_scale^2)) (checked below)
            names.append("NIE")
            kw.append(dict(theta_E=1.0, e1=e1, e2=e2, s_scale=np.sqrt(q) * s, center_x=0.0, center_y=0.0))
        else:
            names.append("SIE")
            kw.append(dict(theta_E=1.0, e1=e1, e2=e2, center_x=0.0, center_y=0.0))
    # subhalos: pseudo-Jaffe = SIS(b) minus the cored isothermal sphere with core a,
    # i.e. NIE(theta_E = -b, s_scale = a) at q = 1
    for sub in spec.get("subs", []):
        if sub.get("prof") == "nfw":
            # lenstronomy's TNFW (Baltz, Marshall & Oguri 2009) is parameterized by R_s, r_trunc and
            # alpha_Rs, the deflection at R_s of the UNTRUNCATED NFW with the same rho_0 ("neglects
            # the truncation"): M_proj,NFW(1) = M0 (F(1) + ln 1/2) = M0 (1 + ln 1/2) (BMO09)
            names.append("TNFW")
            kw.append(dict(Rs=sub["ts"], alpha_Rs=sub["m0"] * (1 + np.log(0.5)) / sub["ts"],
                           r_trunc=sub["tau"] * sub["ts"], center_x=sub["x"], center_y=sub["y"]))
            continue
        names += ["SIS", "NIE"]
        kw += [dict(theta_E=sub["b"], center_x=sub["x"], center_y=sub["y"]),
               dict(theta_E=-sub["b"], e1=0.0, e2=0.0, s_scale=sub["a"], center_x=sub["x"], center_y=sub["y"])]
    g = spec.get("g", 0.0)
    if g:
        gpa = spec.get("gpa", 0.0)
        names.append("SHEAR")
        kw.append(dict(gamma1=g * np.cos(2 * gpa), gamma2=g * np.sin(2 * gpa), ra_0=0, dec_0=0))
    return LensModel(names), kw


def bmo_mp(x, t):
    """BMO09 projected mass of the truncated NFW in units of M0 (written out here independently)."""
    F = np.arccos(1 / x) / np.sqrt(x * x - 1) if x > 1 else (np.arccosh(1 / x) / np.sqrt(1 - x * x) if x < 1 else 1.0)
    L = np.log(x / (np.sqrt(t * t + x * x) + t))
    return t * t / (t * t + 1) ** 2 * ((t * t + 1 + 2 * (x * x - 1)) * F + t * np.pi + (t * t - 1) * np.log(t)
                                       + np.sqrt(t * t + x * x) * (-np.pi + (t * t - 1) / t * L))


def kappa_js(spec, x, y):
    """physics.js convergence, written out independently here."""
    k = 0.0 * x
    if spec["model"] != "point":
        q, s, pa = spec.get("q", 1.0), spec.get("s", 0.0), spec.get("pa", 0.0)
        xl = np.cos(pa) * x + np.sin(pa) * y
        yl = -np.sin(pa) * x + np.cos(pa) * y
        k = k + 0.5 / np.sqrt(q * s * s + q * xl * xl + yl * yl / q)
    for sub in spec.get("subs", []):     # Dalal & Kochanek (2002) pseudo-Jaffe
        if sub.get("prof") == "nfw":
            continue                         # (checked against lenstronomy point by point instead)
        r2 = (x - sub["x"]) ** 2 + (y - sub["y"]) ** 2
        k = k + 0.5 * sub["b"] * (1 / np.sqrt(r2) - 1 / np.sqrt(r2 + sub["a"] ** 2))
    return k


CASES = [
    dict(model="point"),
    dict(model="point", g=0.2, gpa=0.5),
    dict(model="iso", s=0.0, q=1.0),
    dict(model="iso", s=0.3, q=1.0),
    dict(model="iso", s=0.0, q=0.7, pa=0.4, g=0.1, gpa=1.3),
    dict(model="iso", s=0.0, q=0.45, pa=-0.9),
    dict(model="iso", s=0.1, q=0.6, pa=0.2, g=0.08, gpa=-0.6),
]


def sub_from_mass(M, x, y):
    # M in Msun for theta_E = 1 arcsec (pi Sigma_c theta_E^2 = 2.5159e11 Msun); a = sqrt(b b_0)
    b = (M / 2.5159e11) ** (2 / 3)
    return dict(x=x, y=y, b=b, a=np.sqrt(b))


def nfw_from_mass(M, x, y):
    # the page's recipe (app.js subParams): same mass and truncation radius as the pseudo-Jaffe clump,
    # r_s from the Duffy et al. (2008) concentration at z_l = 0.5, Planck 2018
    s = sub_from_mass(M, x, y)
    r200 = (3 * M / (4 * np.pi * 200 * 220.9606)) ** (1 / 3)
    c200 = 5.71 * (M * 0.6766 / 2e12) ** -0.084 * 1.5 ** -0.47
    ts = r200 / c200 / 6.2910
    tau = s["a"] / ts
    t2 = tau * tau
    tot = t2 / (t2 + 1) ** 2 * ((t2 - 1) * np.log(tau) + tau * np.pi - (t2 + 1))
    s.update(prof="nfw", ts=ts, tau=tau, m0=(M / 2.5159e11) / tot)
    return s


CASES += [
    dict(model="iso", s=0.0, q=0.7, pa=0.4, g=0.08, gpa=2.1,
         subs=[sub_from_mass(1e9, 0.9, 0.5), sub_from_mass(3e9, -0.8, 0.7), sub_from_mass(1e8, 0.1, -1.1)]),
    dict(model="point", subs=[sub_from_mass(1e10, 1.0, 0.2), sub_from_mass(1e9, -0.5, 0.8)]),
    dict(model="iso", s=0.0, q=0.7, pa=0.4, g=0.08, gpa=2.1,
         subs=[nfw_from_mass(1e10, 0.9, 0.5), nfw_from_mass(1e9, -0.8, 0.7), nfw_from_mass(1e8, 0.1, -1.1)]),
]

out = {"cases": []}
for spec in CASES:
    lm, kw = lenstronomy_model(spec)
    # random points: deflection, Hessian, potential, convergence
    x = rng.uniform(-2.5, 2.5, 40)
    y = rng.uniform(-2.5, 2.5, 40)
    keep = np.hypot(x, y) > 0.05
    x, y = x[keep], y[keep]
    ax, ay = lm.alpha(x, y, kw)
    fxx, fxy, fyx, fyy = lm.hessian(x, y, kw)
    psi = lm.potential(x, y, kw)
    kap = lm.kappa(x, y, kw)
    # the convergence must match the physics.js definition (catches convention slips)
    # lenstronomy's NIE Hessian (hence kappa and the magnification) is a one-sided finite
    # difference of the deflection, good to ~1e-6; its deflection and potential are analytic.
    # A convention slip (axis ratio, orientation, normalization, core) would show up at O(0.1).
    # (absolute: the point mass contributes kappa = 0 away from its center)
    if not any(s.get("prof") == "nfw" for s in spec.get("subs", [])):
        kerr = np.max(np.abs(kap - kappa_js(spec, x, y)))
        assert kerr < 1e-4, (spec, kerr)
    else:
        kerr = float("nan")
    pts = [dict(x=float(a), y=float(b), ax=float(c), ay=float(d), fxx=float(e), fyy=float(f),
                fxy=float(g), psi=float(h))
           for a, b, c, d, e, f, g, h in zip(x, y, ax, ay, fxx, fyy, fxy, psi)]
    # sources, with lenstronomy's solver; prefer positions that give several images
    solver = LensEquationSolver(lm)
    srcs = []
    for k in range(14):
        r = 0.6 * rng.uniform() ** 0.7 if k < 10 else rng.uniform(0.6, 1.4)
        ph = rng.uniform(0, 2 * np.pi)
        bx, by = r * np.cos(ph), r * np.sin(ph)
        xi, yi = solver.image_position_from_source(bx, by, kw, min_distance=0.005, search_window=8,
                                                   precision_limit=1e-12, num_iter_max=200,
                                                   arrival_time_sort=False)
        if len(xi) == 0:
            continue
        mu = lm.magnification(xi, yi, kw)
        tau = lm.fermat_potential(xi, yi, kw, x_source=bx, y_source=by)
        srcs.append(dict(bx=float(bx), by=float(by),
                         images=[dict(x=float(a), y=float(b), mu=float(c), tau=float(d))
                                 for a, b, c, d in zip(xi, yi, mu, tau)]))
    # sources whose smooth-lens image lands on each clump
    if spec.get("subs"):
        smooth = {k: v for k, v in spec.items() if k != "subs"}
        lm0, kw0 = lenstronomy_model(smooth)
        for sub in spec["subs"]:
            ax0, ay0 = lm0.alpha(sub["x"], sub["y"], kw0)
            for k in range(3):
                r = 0 if k == 0 else sub["b"] * rng.uniform(0.3, 1.5)
                ph = rng.uniform(0, 2 * np.pi)
                bx, by = sub["x"] - ax0 + r * np.cos(ph), sub["y"] - ay0 + r * np.sin(ph)
                xi, yi = solver.image_position_from_source(bx, by, kw, min_distance=0.001, search_window=6,
                                                           precision_limit=1e-12, num_iter_max=300,
                                                           arrival_time_sort=False)
                if len(xi) == 0:
                    continue
                mu = lm.magnification(xi, yi, kw)
                tau = lm.fermat_potential(xi, yi, kw, x_source=bx, y_source=by)
                srcs.append(dict(bx=float(bx), by=float(by), images=[dict(x=float(a), y=float(b), mu=float(c), tau=float(d))
                                                                     for a, b, c, d in zip(xi, yi, mu, tau)]))
    out["cases"].append(dict(spec=spec, points=pts, sources=srcs))
    print(spec, "kappa max err %.1e" % kerr, " sources:", [len(s["images"]) for s in srcs])

# delay scale for theta_E = 1 arcsec, z_l = 0.5, z_s = 2 (Planck 2018)
from astropy.cosmology import Planck18
import astropy.units as u
import astropy.constants as c
Dl = Planck18.angular_diameter_distance(0.5)
Ds = Planck18.angular_diameter_distance(2.0)
Dls = Planck18.angular_diameter_distance_z1z2(0.5, 2.0)
T = ((1 + 0.5) * Dl * Ds / Dls / c.c * (1 * u.arcsec).to(u.rad).value ** 2).to(u.day).value
out["Tstar_days"] = T
print("T_* = %.4f days" % T)

os.makedirs(os.path.join(HERE, "cache"), exist_ok=True)
with open(os.path.join(HERE, "cache", "lenstronomy_cases.json"), "w") as f:
    json.dump(out, f)
