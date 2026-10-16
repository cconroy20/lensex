#!/bin/bash
# Download the primary sources into rawdata/, unmodified: the executable record of where
# the lens formulas come from.  Nothing in web/ reads these files.
set -e
cd "$(dirname "$0")"
# Keeton (2001), "A catalog of mass models for gravitational lensing": the softened isothermal
# ellipsoid (deflection, potential), Sect. 3, catalog.tex
mkdir -p rawdata/keeton2001
curl -sfL -o rawdata/keeton2001/src.tar https://arxiv.org/e-print/astro-ph/0102341
(cd rawdata/keeton2001 && tar xzf src.tar)
# Dalal & Kochanek (2002, ApJ 572, 25): pseudo-Jaffe subhalos, M = pi b a Sigma_c, a = sqrt(b b_0), Sect. 3, ms.tex
mkdir -p rawdata/dalal2002
curl -sfL -o rawdata/dalal2002/src https://arxiv.org/e-print/astro-ph/0111456
(cd rawdata/dalal2002 && tar xzf src)
echo "fetched: $(ls rawdata/keeton2001/catalog.tex rawdata/dalal2002/ms.tex | tr '\n' ' ')"
