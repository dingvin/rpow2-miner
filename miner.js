#!/usr/bin/env node
process.stdout.write('\x1b[32m'); // green text

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');
const zlib = require('zlib');
const https = require('https');
const os = require('os');

const API_BASE = 'https://api.rpow2.com';
const SESSION_COOKIE = process.argv[2];
const NUM_THREADS = parseInt(process.argv[3]) || os.cpus().length;

// ─── WORKER THREAD ─────────────────────────────────────────────────────────
if (!isMainThread) {
  const { noncePrefix, difficultyBits, startNonce, step } = workerData;

  // Count trailing zero bits (matches browser BA() function exactly)
  function countTrailingZeroBits(buf) {
    let count = 0;
    for (let i = buf.length - 1; i >= 0; i--) {
      const byte = buf[i];
      if (byte === 0) { count += 8; continue; }
      let c = 0;
      while (!(byte & (1 << c))) c++;
      return count + c;
    }
    return count;
  }

  // Hex string -> Uint8Array (matches browser EA() function)
  function hexToBytes(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++)
      arr[i] = parseInt(hex.substr(i * 2, 2), 16);
    return arr;
  }

  const prefixBytes = hexToBytes(noncePrefix);
  // input = prefixBytes + 8 bytes nonce (little-endian BigInt)
  const input = Buffer.alloc(prefixBytes.length + 8);
  prefixBytes.forEach((b, i) => input[i] = b);

  let nonce = BigInt(startNonce);
  const stepBig = BigInt(step);
  let hashes = 0;
  const reportEvery = 50000;

  while (true) {
    // Write nonce as 8-byte little-endian (matches browser logic)
    let o = nonce;
    for (let y = 0; y < 8; y++) {
      input[prefixBytes.length + y] = Number(o & 0xffn);
      o >>= 8n;
    }

    const hash = crypto.createHash('sha256').update(input).digest();

    if (countTrailingZeroBits(hash) >= difficultyBits) {
      parentPort.postMessage({ found: true, solutionNonce: nonce.toString(), hash: hash.toString('hex') });
      break;
    }

    nonce += stepBig;
    hashes++;

    if (hashes % reportEvery === 0) {
      parentPort.postMessage({ found: false, hashes: reportEvery });
    }
  }
  return;
}

// ─── MAIN THREAD ───────────────────────────────────────────────────────────
if (!SESSION_COOKIE) {
  console.log('\n  rpow2 CLI Miner v2.0');
  console.log('  Usage: node miner.js "rpow_session=VALUE" [THREADS]');
  console.log('\n  Get cookie: F12 -> Application -> Cookies -> rpow2.com -> rpow_session\n');
  process.exit(1);
}

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.rpow2.com',
      path,
      method,
      headers: {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.8',
        'Content-Type': 'application/json',
        'Cookie': cookie,
        'Origin': 'https://rpow2.com',
        'Priority': 'u=1, i',
        'Referer': 'https://rpow2.com/',
        'Sec-Ch-Ua': '"Chromium";v="148", "Brave";v="148", "Not/A)Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'Sec-Gpc': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, res => {
      const encoding = res.headers['content-encoding'];
      let stream = res;
      if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
      
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const setCookie = res.headers['set-cookie'];
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), setCookie }); }
        catch { resolve({ status: res.statusCode, body: raw, setCookie }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function mine(noncePrefix, difficultyBits) {
  return new Promise((resolve, reject) => {
    const workers = [];
    let totalHashes = 0;
    let solved = false;
    const startTime = Date.now();

    process.stdout.write(`  Mining | difficulty: ${difficultyBits} bits | threads: ${NUM_THREADS}\n`);

    for (let i = 0; i < NUM_THREADS; i++) {
      const worker = new Worker(__filename, {
        workerData: { noncePrefix, difficultyBits, startNonce: i, step: NUM_THREADS }
      });

      worker.on('message', msg => {
        if (solved) return;
        if (msg.found) {
          solved = true;
          workers.forEach(w => w.terminate());
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const mhs = (totalHashes / 1e6 / ((Date.now() - startTime) / 1000)).toFixed(2);
          process.stdout.write(`\n  [OK] Found! nonce: ${msg.solutionNonce} | ${elapsed}s | ${mhs} MH/s\n`);
          resolve({ solutionNonce: msg.solutionNonce });
        } else {
          totalHashes += msg.hashes;
          const elapsed = (Date.now() - startTime) / 1000 || 0.001;
          const mhs = (totalHashes / 1e6 / elapsed).toFixed(2);
          process.stdout.write(`  ${mhs} MH/s | ${(totalHashes / 1e6).toFixed(1)}M hashes...\r`);
        }
      });

      worker.on('error', reject);
      workers.push(worker);
    }
  });
}

let sessionMinted = 0;
let currentCookie = SESSION_COOKIE;

async function runMiner() {
  console.log('\n  ================================');
  console.log('    rpow2 CLI Miner v2.0');
  console.log(`    Threads: ${NUM_THREADS}`);
  console.log('  ================================\n');

  console.log('  Checking auth...');
  const me = await request('GET', '/me', null, currentCookie);
  if (me.status !== 200) {
    console.log(`\n  [ERROR] Auth failed (${me.status}). Check your cookie.`);
    process.exit(1);
  }
  if (me.setCookie) currentCookie = me.setCookie.join('; ');

  console.log(`  Logged in as: ${me.body?.email || '?'}`);
  console.log(`  Balance: ${me.body?.balance ?? me.body?.tokens ?? '?'} RPOW`);
  console.log('\n  Mining... Press Ctrl+C to stop.');
  console.log('  --------------------------------');

  while (true) {
    try {
      process.stdout.write('\n  Fetching challenge...\n');
      const chalRes = await request('POST', '/challenge', {}, currentCookie);
      if (chalRes.setCookie) currentCookie = chalRes.setCookie.join('; ') || currentCookie;

      if (chalRes.status === 503 || chalRes.status === 502) {
        console.log(`  [WAIT] Server overloaded (${chalRes.status}) — retrying in 5s...`);
        await sleep(5000);
        continue;
      }
      if (chalRes.status === 404) {
        console.log(`  [WAIT] Server hiccup (404) — retrying in 3s...`);
        await sleep(3000);
        continue;
      }
      if (chalRes.status !== 200) {
        console.log(`  [WARN] Challenge failed (${chalRes.status}) — retrying in 3s...`);
        await sleep(3000);
        continue;
      }

      const { challenge_id, nonce_prefix, difficulty_bits } = chalRes.body;
      if (!challenge_id || !nonce_prefix || !difficulty_bits) {
        console.log('  [WARN] Bad response:', JSON.stringify(chalRes.body));
        await sleep(3000);
        continue;
      }

      console.log(`  ID: ${challenge_id.slice(0,8)}... | prefix: ${nonce_prefix.slice(0,8)}...`);

      const { solutionNonce } = await mine(nonce_prefix, difficulty_bits);

      process.stdout.write('  Submitting...\n');
      const mintRes = await request('POST', '/mint', { challenge_id, solution_nonce: solutionNonce }, currentCookie);
      if (mintRes.setCookie) currentCookie = mintRes.setCookie.join('; ') || currentCookie;

      if (mintRes.status === 200 || mintRes.status === 201) {
        sessionMinted++;
        console.log(`  [MINTED] ${JSON.stringify(mintRes.body)}`);
        console.log(`  Session total: ${sessionMinted} mints`);
      } else {
        console.log(`  [WARN] Mint failed (${mintRes.status}): ${JSON.stringify(mintRes.body)}`);
        await sleep(1000);
      }

    } catch (err) {
      console.log(`\n  [ERROR] ${err.message}`);
      await sleep(3000);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

process.on('SIGINT', () => {
  console.log(`\n\n  Stopped. ${sessionMinted} mints this session.\x1b[0m`);
  process.exit(0);
});

runMiner().catch(err => { console.error('Fatal:', err); process.exit(1); });