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
# Baltz, Marshall & Oguri (2009, JCAP 01, 015): truncated NFW lensing, appendix A, NFW_truncated.tex
mkdir -p rawdata/bmo2009
curl -sfL -o rawdata/bmo2009/src https://arxiv.org/e-print/0705.0682
(cd rawdata/bmo2009 && tar xzf src)
# Duffy et al. (2008, MNRAS 390, L64): c(M, z), Table 1, update_concmass.tex
mkdir -p rawdata/duffy2008
curl -sfL -o rawdata/duffy2008/src https://arxiv.org/e-print/0804.2486
(cd rawdata/duffy2008 && tar xzf src)
echo "fetched: $(ls rawdata/keeton2001/catalog.tex rawdata/dalal2002/ms.tex rawdata/bmo2009/NFW_truncated.tex rawdata/duffy2008/update_concmass.tex | tr '\n' ' ')"
