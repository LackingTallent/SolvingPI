#!/usr/bin/env python3
"""The promo film, five movements on one 1280x720@25 canvas:

  I   the spreadsheet grind   II  the player at 2 AM   III Earth — the scale
  IV  the product demo        V   the Solving PI logo card

AUDIO (v3):
  - the NARRATION (uploaded take) split into its five scripted lines and
    spliced to the movement anchors;
  - each Gemini clip's OWN audio kept under its movement;
  - a new original score — curious music-box minor for the grind, a EUREKA
    lift into bright C-major at Earth, energetic pitch-deck drive (plucks,
    kick, bass, claps) through the demo, triumphant resolve on the logo;
  - everything sidechain-ducked under the voice.

Run: python3 tools/make-film.py
Out: /home/claude/rebuild/solvingpi-promo.mp4
"""
import numpy as np
from scipy.signal import butter, lfilter
import subprocess, wave, os, tempfile

UP = "/root/.claude/uploads/6687f901-589a-5ab2-b40c-fb5396f70d78"
CLIP1 = os.path.join(UP, "8df043e3-gemini_generated_video_2a0af279.mp4")   # grid
CLIP2 = os.path.join(UP, "251a8443-gemini_generated_video_50f49fea.mp4")   # player
CLIP3 = os.path.join(UP, "463ecf73-gemini_generated_video_e68f5651.mp4")   # earth
VO_SRC = os.path.join(UP, "e067f5b6-a53b997791d949eba7a8f9e975dcd5d1.mp3") # narration
DEMO = "/home/claude/rebuild/solvingpi-trailer.mp4"
CARD = "/home/claude/rebuild/frames/logo-card.png"
OUT = "/home/claude/rebuild/solvingpi-promo.mp4"
WAV = "/tmp/promo_score.wav"
FPS, FADE = 25, 0.6

D1 = D2 = D3 = 10.005
D4, D5 = 32.32, 6.5
oA = D1 - FADE
oB = oA + D2 - FADE
oC = oB + D3 - FADE
oD = oC + D4 - FADE
DUR = oD + D5
print(f"timeline: player@{oA:.2f} earth@{oB:.2f} demo@{oC:.2f} logo@{oD:.2f} total {DUR:.2f}s")

SR = 44100
N = int(SR * (DUR + 0.4))
t = np.arange(N) / SR

def to_wav_mono(path):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR), tmp], check=True)
    with wave.open(tmp) as w:
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32767
    os.unlink(tmp)
    return raw

# ---------------------------------------------------------------------------
# 1. NARRATION: split the take into its five lines, splice to the anchors.
#    Cut points verified against the read's phrase structure (the tagline is
#    the final two phrases; the opening line is three).
# ---------------------------------------------------------------------------
vo_raw = to_wav_mono(VO_SRC)
LINES = [  # (src_start, src_end, film_time)
    (0.00, 4.90, 2.0),         # "Every week... somebody opens the spreadsheet."
    (5.05, 12.55, oA + 1.5),   # "...it stops being a game."
    (12.72, 16.60, oB + 1.5),  # "But what if the numbers... ran themselves?"
    (16.78, 18.15, oC + 1.5),  # "One question. Every answer."
    (18.38, 21.80, oD + 0.7),  # "Solving PI... so you don't have to."
]
vo = np.zeros(N)
edge = int(0.04 * SR)
for s0, s1, at in LINES:
    seg = vo_raw[int(s0 * SR):int(s1 * SR)].copy()
    if len(seg) > 2 * edge:
        seg[:edge] *= np.linspace(0, 1, edge)
        seg[-edge:] *= np.linspace(1, 0, edge)
    i0 = int(at * SR)
    L = min(len(seg), N - i0)
    vo[i0:i0+L] += seg[:L]
vo /= max(1e-9, np.max(np.abs(vo))) / 0.92

# Sidechain envelope from the voice itself.
win = int(0.05 * SR)
env_vo = np.sqrt(np.convolve(vo ** 2, np.ones(win) / win, "same"))
env_vo = np.clip(env_vo / (env_vo.max() + 1e-9), 0, 1)
b, a = butter(1, 3.0 / (SR / 2), "low")   # ~80ms attack / slow release feel
duck_env = lfilter(b, a, env_vo)
duck_env = np.clip(duck_env / (duck_env.max() + 1e-9), 0, 1)
duck = 1.0 - 0.62 * duck_env              # music floor ~0.38 under speech

# ---------------------------------------------------------------------------
# 2. THE SCORE — eureka & uplift.
#    bpm 112 grid; A-minor curiosity -> C-major AHA at Earth -> driving
#    pitch energy -> triumphant close.
# ---------------------------------------------------------------------------
music = np.zeros(N)
BPM = 112.0
BEAT = 60.0 / BPM
rng = np.random.default_rng(7)

def env_seg(attack, release, start, length):
    e = np.zeros(N)
    i0, i1 = int(start * SR), min(int((start + length) * SR), N)
    if i1 <= i0: return e
    seg = np.ones(i1 - i0)
    aa = min(int(attack * SR), len(seg)); rr = min(int(release * SR), len(seg))
    if aa: seg[:aa] = np.linspace(0, 1, aa) ** 2
    if rr: seg[-rr:] *= np.linspace(1, 0, rr) ** 1.5
    e[i0:i1] = seg
    return e

def pad(freq, start, length, amp, detune=0.002):
    out = np.zeros(N)
    for mul, ha in ((1, 1.0), (2, 0.34), (3, 0.12)):
        for dt in (-detune, 0.0, detune):
            out += ha * np.sin(2 * np.pi * freq * mul * (1 + dt) * t + hash((mul, dt)) % 7)
    return out * env_seg(1.6, 2.0, start, length) * amp

def pluck(freq, at, amp=1.0, dur=0.45):
    """Bright pitched pluck — the pitch-deck marimba/pizz voice."""
    i0 = int(at * SR)
    L = min(int(dur * SR), N - i0)
    if L <= 0: return
    ts = np.arange(L) / SR
    tone = (np.sin(2 * np.pi * freq * ts) + 0.45 * np.sin(2 * np.pi * freq * 2 * ts)
            + 0.18 * np.sin(2 * np.pi * freq * 3 * ts + 0.7))
    music[i0:i0+L] += amp * tone * np.exp(-7.5 * ts) * min(1.0, freq / 220)

def bassnote(freq, at, amp=0.30, dur=0.22):
    i0 = int(at * SR); L = min(int(dur * SR), N - i0)
    if L <= 0: return
    ts = np.arange(L) / SR
    e = np.minimum(1, ts / 0.01) * np.exp(-9 * ts)
    music[i0:i0+L] += amp * np.sin(2 * np.pi * freq * ts) * e

def kick(at, amp=0.5):
    i0 = int(at * SR); L = min(int(0.28 * SR), N - i0)
    if L <= 0: return
    ts = np.arange(L) / SR
    music[i0:i0+L] += amp * np.sin(2 * np.pi * (95 * np.exp(-18 * ts) + 42) * ts) * np.exp(-16 * ts)

def hat(at, amp=0.05):
    i0 = int(at * SR); L = min(int(0.035 * SR), N - i0)
    if L <= 0: return
    nz = rng.standard_normal(L) * np.hanning(L) * 2
    b2, a2 = butter(2, [5800 / (SR/2), 11000 / (SR/2)], "band")
    music[i0:i0+L] += amp * lfilter(b2, a2, nz)

def clap(at, amp=0.16):
    i0 = int(at * SR); L = min(int(0.12 * SR), N - i0)
    if L <= 0: return
    ts = np.arange(L) / SR
    nz = rng.standard_normal(L) * np.exp(-28 * ts)
    b2, a2 = butter(2, [900 / (SR/2), 4500 / (SR/2)], "band")
    music[i0:i0+L] += amp * lfilter(b2, a2, nz)

def sparkle(at, root, amp=0.11):
    """The eureka 'ding': a fast rising major arpeggio, two octaves up."""
    for k, mul in enumerate((1, 1.25, 1.5, 2, 2.5, 3, 4)):
        pluck(root * 2 * mul, at + 0.07 * k, amp=amp * (1 - 0.09 * k), dur=0.8)

# Note frequencies.
A2, C3, E3, F3, G3, A3 = 110.0, 130.81, 164.81, 174.61, 196.0, 220.0
C4, D4n, E4, F4, G4, A4, B3 = 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 246.94
C5, G2 = 523.25, 98.0

# Chord schedule: (start, end, pad_notes, arp_tones, bass_root)
Am = ([A2, E3, A3, C4], [A3, C4, E4, A4], A2)
Fmaj = ([F3/2, C3, F3, A3], [A3, C4, F4, A4], F3/2)
Cmaj = ([C3, G3, C4, E4], [C4, E4, G4, C5], C3)
Gmaj = ([G2, D4n/2, G3, B3], [B3, D4n, G4, B3*2], G2)
def bars(n): return n * 4 * BEAT

SCHED = []
# I: curiosity — Am/F, sparse.
SCHED += [(0.0, 5.2, Am), (5.2, oA, Fmaj)]
# II: the weight — Am, F (arps thicken, anticipation).
SCHED += [(oA, oA + 4.8, Am), (oA + 4.8, oB, Fmaj)]
# III: THE AHA — C major from the Earth hit.
SCHED += [(oB, oB + 4.8, Cmaj), (oB + 4.8, oC, Gmaj)]
# IV: drive — C G Am F loop.
cur = oC
loop = [Cmaj, Gmaj, Am, Fmaj]
k = 0
while cur < oD - 2.0:
    seg_end = min(cur + bars(2), oD - 0.2)
    SCHED.append((cur, seg_end, loop[k % 4]))
    cur = seg_end; k += 1
# V: home — C major to the end.
SCHED.append((oD - 0.2, DUR, Cmaj))

for start, end, (padn, arp, broot) in SCHED:
    for j, f in enumerate(padn):
        music += pad(f, start, end - start + 0.8, amp=0.10 * (1.0 - 0.1 * j))

# Arpeggios: 8th notes; density and level grow by movement.
def arp_level(x):
    if x < oA: return 0.10, 2      # sparse quarters (every 2nd 8th)
    if x < oB: return 0.14, 1      # 8ths
    if x < oC: return 0.20, 1
    if x < oD: return 0.22, 1
    return 0.18, 1
for start, end, (padn, arp, broot) in SCHED:
    k = 0
    x = start
    while x < end - 0.05:
        ampl, every = arp_level(x)
        if k % every == 0:
            tone = arp[(k // every) % len(arp)]
            pluck(tone, x, amp=ampl)
        x += BEAT / 2; k += 1

# Rhythm section from the AHA onward.
x = oB
beat_i = 0
while x < DUR - 2.2:
    kick(x, amp=0.45 if x < oC else 0.55)
    if x >= oC and beat_i % 2 == 1:
        clap(x, amp=0.15 if x < oC + 13 else 0.20)
    hh = BEAT / 2
    for h in range(2 if x < oC + 13 else 4):
        hat(x + h * (BEAT / (2 if x < oC + 13 else 4)), amp=0.045)
    x += BEAT; beat_i += 1

def root_at(x):
    for start, end, (padn, arp, broot) in SCHED:
        if start <= x < end: return broot
    return C3
x = oB
while x < DUR - 2.2:
    bassnote(root_at(x), x, amp=0.30, dur=0.20)
    bassnote(root_at(x), x + BEAT / 2, amp=0.20, dur=0.14)
    x += BEAT

# Eureka moments: sparkle + boom at the Earth hit, sparkle at the logo.
def boom(at, amp):
    i0 = int(at * SR); L = min(int(1.6 * SR), N - i0)
    seg = np.arange(L) / SR
    th = np.sin(2 * np.pi * (50 - 16 * seg) * seg) * np.exp(-3.0 * seg)
    b2, a2 = butter(2, 380 / (SR / 2), "low")
    music[i0:i0+L] += amp * 0.5 * lfilter(b2, a2, th)
boom(oB, 0.9); boom(oC, 0.6); boom(oD, 1.0)
sparkle(oB + 0.05, C4, amp=0.13)
sparkle(oD + 0.10, C4, amp=0.15)

# Risers into the AHA and into the logo.
for rise_at, rlen in ((oB - 4.0, 4.0), (oD - 5.0, 5.0)):
    i0 = int(rise_at * SR); L = min(int(rlen * SR), N - i0)
    segn = rng.standard_normal(L)
    b2, a2 = butter(2, [400 / (SR/2), 3000 / (SR/2)], "band")
    music[i0:i0+L] += 0.09 * lfilter(b2, a2, segn) * (np.arange(L) / L) ** 2.2

# Gentle master shaping.
b, a = butter(1, 8200 / (SR / 2), "low")
music = lfilter(b, a, music)
music[:SR] *= np.linspace(0, 1, SR)

# ---------------------------------------------------------------------------
# 3. Source clip audio, kept under each movement.
# ---------------------------------------------------------------------------
bed = np.zeros(N)
for path, start, dur in ((CLIP1, 0.0, D1), (CLIP2, oA, D2), (CLIP3, oB, D3)):
    raw = to_wav_mono(path)
    L = min(len(raw), int(dur * SR))
    seg = raw[:L].copy()
    f = int(FADE * SR)
    seg[:f] *= np.linspace(0, 1, f)
    seg[-f:] *= np.linspace(1, 0, f)
    peak = np.max(np.abs(seg))
    if peak > 1e-6: seg *= min(1.0, 0.48 / peak)
    i0 = int(start * SR)
    bed[i0:i0+L] += seg

# ---------------------------------------------------------------------------
# 4. Mix: (score + clip bed) ducked under the voice, then the voice on top.
# ---------------------------------------------------------------------------
music /= np.max(np.abs(music)) / 0.62
mix = (music + bed) * duck + vo
fo = int(2.4 * SR); mix[-fo:] *= np.linspace(1, 0, fo) ** 1.2
peak = np.max(np.abs(mix))
if peak > 0.97: mix *= 0.97 / peak
haas = int(0.011 * SR)
stereo = np.stack([mix, np.concatenate([np.zeros(haas), mix[:-haas]])], axis=1)
with wave.open(WAV, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes())
print(f"mix: {DUR:.1f}s (score + clip audio + narration)")

# ---------------------------------------------------------------------------
# 5. The film (unchanged videography).
# ---------------------------------------------------------------------------
card_frames = int(D5 * FPS) + 1
fc = ";".join([
    f"[0:v]fps={FPS},scale=1280:720,format=yuv420p,settb=AVTB[v0]",
    f"[1:v]fps={FPS},scale=1280:720,format=yuv420p,settb=AVTB[v1]",
    f"[2:v]fps={FPS},scale=1280:720,format=yuv420p,settb=AVTB[v2]",
    f"[3:v]fps={FPS},scale=1152:720:flags=lanczos,pad=1280:720:64:0:color=0x05060a,format=yuv420p,settb=AVTB[v3]",
    f"[4:v]scale=2560:1440:flags=lanczos,zoompan=z='min(1.05,1+0.0012*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    f":d={card_frames}:s=1280x720:fps={FPS},format=yuv420p,settb=AVTB[v4]",
    f"[v0][v1]xfade=transition=fade:duration={FADE}:offset={oA:.3f}[x1]",
    f"[x1][v2]xfade=transition=fade:duration={FADE}:offset={oB:.3f}[x2]",
    f"[x2][v3]xfade=transition=fade:duration={FADE}:offset={oC:.3f}[x3]",
    f"[x3][v4]xfade=transition=fade:duration={FADE}:offset={oD:.3f},fade=t=out:st={DUR-0.7:.2f}:d=0.7,format=yuv420p[vout]",
])
subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
    "-i", CLIP1, "-i", CLIP2, "-i", CLIP3, "-i", DEMO, "-i", CARD, "-i", WAV,
    "-filter_complex", fc, "-map", "[vout]", "-map", "5:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "main", "-level", "4.0", "-preset", "medium", "-crf", "21",
    "-c:a", "aac", "-profile:a", "aac_low", "-ar", "44100", "-b:a", "160k",
    "-shortest", "-movflags", "+faststart", OUT], check=True)
p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size",
                    "-of", "default=nw=1", OUT], capture_output=True, text=True)
print(p.stdout.strip()); print("promo:", OUT)
