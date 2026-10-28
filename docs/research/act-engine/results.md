# Measured results

Generated from [runs.jsonl](evidence/runs.jsonl) by `benchmarks/summarize.py`.
RSS and CPU cover the timed host command, not Docker containers or the Docker VM. Integration RSS is the Bun scheduler command/process accounting, not the desktop GUI.
Ranges are observed min/max, not confidence intervals. Small n and uncontrolled host/network noise limit generalization.
Included 106 timing trials: 106 exited successfully. Also retained 18 explicitly excluded pilot trials; see each record's excluded_reason.

## Primary paired cohort

| Workload / mode | n | Total seconds: median [min–max] | First main step: median s | Peak RSS: median MiB | CPU user+sys: median s |
| --- | ---: | ---: | ---: | ---: | ---: |
| dag / current | 3 | 9.429 [9.108–9.766] | 2.709 | 39.266 | 0.210 |
| dag / optimized | 3 | 9.488 [8.809–9.524] | 2.670 | 39.156 | 0.200 |
| minimal / current | 3 | 2.248 [2.113–3.124] | 2.096 | 39.016 | 0.100 |
| minimal / optimized | 3 | 2.674 [2.496–2.961] | 2.531 | 39.109 | 0.090 |
| multistep / current | 3 | 4.027 [3.401–5.708] | 2.040 | 39.484 | 0.250 |
| multistep / optimized | 3 | 3.865 [3.293–4.247] | 2.463 | 39.297 | 0.260 |
| node / current | 3 | 8.473 [7.727–8.937] | 1.848 | 39.219 | 0.130 |
| node / optimized | 3 | 10.042 [7.884–11.183] | 2.087 | 39.062 | 0.150 |
| parallel / current | 3 | 6.092 [5.486–25.009] | 2.287 | 39.266 | 0.260 |
| parallel / optimized | 3 | 5.443 [5.208–5.949] | 2.711 | 39.469 | 0.290 |
| typescript / current | 3 | 11.648 [9.866–13.547] | 2.261 | 38.766 | 0.150 |
| typescript / optimized | 3 | 11.086 [10.684–15.527] | 2.517 | 38.984 | 0.160 |

## Platform-specific digest versus mutable tag, clean later paired cohort

| Workload / mode | n | Total seconds: median [min–max] | First main step: median s | Peak RSS: median MiB | CPU user+sys: median s |
| --- | ---: | ---: | ---: | ---: | ---: |
| minimal / current | 3 | 3.075 [2.086–3.178] | 1.984 | 38.891 | 0.090 |
| minimal / pinned | 3 | 1.047 [0.945–1.281] | 0.742 | 39.250 | 0.070 |
| parallel / current | 3 | 6.153 [5.501–8.834] | 2.737 | 39.578 | 0.310 |
| parallel / pinned | 3 | 3.282 [3.257–3.368] | 0.977 | 38.969 | 0.170 |
| typescript / current | 3 | 17.179 [12.293–18.257] | 2.424 | 39.062 | 0.160 |
| typescript / pinned | 3 | 11.427 [10.520–12.374] | 0.671 | 39.141 | 0.150 |

## Native ARM64 / auto architecture, later paired cohort

| Workload / mode | n | Total seconds: median [min–max] | First main step: median s | Peak RSS: median MiB | CPU user+sys: median s |
| --- | ---: | ---: | ---: | ---: | ---: |
| minimal / native-current | 3 | 2.900 [2.352–4.863] | 2.767 | 39.172 | 0.090 |
| minimal / native-optimized | 3 | 1.509 [1.349–1.551] | 0.420 | 39.094 | 0.070 |
| typescript / native-current | 3 | 7.711 [5.944–13.505] | 2.585 | 39.219 | 0.160 |
| typescript / native-optimized | 3 | 9.082 [8.137–10.308] | 0.476 | 40.031 | 0.150 |

## External action: cold and warm caches

| Workload / mode | n | Total seconds: median [min–max] | First main step: median s | Peak RSS: median MiB | CPU user+sys: median s |
| --- | ---: | ---: | ---: | ---: | ---: |
| current / cold action cache | 1 | 69.588 [69.588–69.588] | 66.262 | 495.797 | 20.300 |
| current / warm action cache | 2 | 8.271 [7.793–8.749] | 4.649 | 42.602 | 0.895 |
| newcache / cold action cache | 1 | 27.971 [27.971–27.971] | 25.072 | 61.609 | 0.380 |
| newcache / warm action cache | 2 | 7.558 [6.528–8.589] | 4.349 | 55.875 | 0.260 |
| optimized / cold action cache | 1 | 48.625 [48.625–48.625] | 45.307 | 326.641 | 8.790 |
| optimized / warm action cache | 2 | 6.479 [5.273–7.684] | 3.222 | 39.219 | 0.345 |

## Additional controlled probes

| Workload / mode | n | Total seconds: median [min–max] | First main step: median s | Peak RSS: median MiB | CPU user+sys: median s |
| --- | ---: | ---: | ---: | ---: | ---: |
| minimal / dryrun | 3 | 1.102 [1.006–1.259] | 0.138 | 39.516 | 0.070 |
| minimal / small / cached image | 3 | 4.852 [4.461–5.079] | 4.657 | 39.375 | 0.110 |
| minimal / small / cold image | 1 | 39.180 [39.180–39.180] | 39.016 | 39.484 | 0.130 |
| node / npmcache / cold npm cache | 1 | 9.954 [9.954–9.954] | 3.208 | 38.750 | 0.110 |
| node / npmcache / warm npm cache | 2 | 5.385 [5.301–5.470] | 2.558 | 39.422 | 0.145 |
| parallel / serial | 3 | 21.549 [20.587–24.754] | 4.095 | 38.797 | 0.270 |
| workspace / bind | 3 | 2.951 [2.687–5.739] | 2.686 | 39.500 | 0.120 |
| workspace / copy | 3 | 3.633 [3.587–4.103] | 2.378 | 38.766 | 0.400 |

## Actual scheduler versus direct subprocess, separate cohort

| Workload / mode | n | Total seconds: median [min–max] | First main step: median s | Peak RSS: median MiB | CPU user+sys: median s |
| --- | ---: | ---: | ---: | ---: | ---: |
| logs / current | 3 | 3.301 [3.236–3.445] | 2.972 | 39.281 | 0.160 |
| logs / integration | 3 | 4.576 [4.322–4.963] | 3.567 | 123.000 | 1.380 |
| minimal / current | 3 | 3.781 [2.895–4.138] | 3.510 | 38.969 | 0.110 |
| minimal / integration | 3 | 3.821 [3.701–4.654] | 3.541 | 100.641 | 0.750 |

