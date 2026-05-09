# rpow2-miner ⛏️

A fast CLI miner for [rpow2.com](https://rpow2.com) — mines RPOW tokens using all your CPU cores simultaneously.

> **Local mining only** — runs on your own PC, no server needed.

---

## How it works

1. Fetches a mining challenge from `api.rpow2.com/challenge`
2. Solves SHA-256 proof-of-work — finds a nonce where `SHA256(prefix_bytes + nonce_bytes)` has N trailing zero bits
3. Submits the solution to `api.rpow2.com/mint`
4. Repeats forever, earning RPOW tokens each round

Mining uses **Node.js Worker Threads** — one thread per CPU core — so it fully utilizes your machine.

---

## Requirements

- Node.js 18+ → https://nodejs.org
- No extra packages needed — uses built-in modules only

---

## Setup

### 1. Clone the repo
```bash
git clone https://github.com/dingvin/rpow2-miner.git
cd rpow2-miner
```

### 2. Get your session cookie
1. Log in at **https://rpow2.com**
2. Press **F12** → **Application** → **Cookies** → `rpow2.com`
3. Find the cookie named **`rpow_session`**
4. Copy the **Value**

### 3. Run the miner
```bash
node miner.js "rpow_session=YOUR_COOKIE_VALUE"
```

With custom thread count (default = all CPU cores):
```bash
node miner.js "rpow_session=YOUR_COOKIE_VALUE" 8
```

---

## Example output

```
  ================================
    rpow2 CLI Miner v2.0
    Threads: 12
  ================================

  Checking auth...
  Logged in as: you@gmail.com
  Balance: 0.124 RPOW

  Mining... Press Ctrl+C to stop.
  --------------------------------

  Fetching challenge...
  ID: 114075c1... | prefix: a2998faf...
  Mining | difficulty: 25 bits | threads: 12
  1.15 MH/s | 29.4M hashes...
  [OK] Found! nonce: 22658242 | 25.5s | 1.15 MH/s
  Submitting...
  [MINTED] {"token":{"id":"075f7ebd...","value_base_units":"1000000"}}
  Session total: 1 mints
```

---

## Performance

| CPU | Threads | Hashrate | Per Hour |
|---|---|---|---|
| Intel i5 (4c/8t) | 8 | ~0.8 MH/s | ~0.08 RPOW |
| Intel i7 (8c/16t) | 16 | ~1.5 MH/s | ~0.15 RPOW |
| Intel Xeon E5-2680 v4 (14c/28t) | 28 | ~3.0 MH/s | ~0.30 RPOW |

> More cores = faster mining. The miner automatically uses all available cores.

---

## Tips

- **Cookie expires** after a few hours — just grab a fresh one from the browser and restart
- **Keep it running 24/7** — don't close the CMD window (Windows + L is fine, just don't close it)
- **Check your stats** at https://stats.rpow2.com
- **Server errors (503/404)** are normal — the miner retries automatically

---

## Notes

- This miner only works with [rpow2.com](https://rpow2.com)
- Mining algorithm: SHA-256 with trailing zero bits (similar to Bitcoin)
- Nonce format: 8-byte little-endian, appended to hex-decoded prefix bytes
- Based on reverse-engineering the official browser worker at `rpow2.com/assets/miner.worker-*.js`

---

## License

MIT