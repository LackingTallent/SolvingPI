#!/usr/bin/env python3
"""The full promo film:

    clip 1 (the spreadsheet grind)  ->  clip 2 (Earth, the scale of it)
    ->  the 32s product demo        ->  the Solving PI logo card

seamlessly crossfaded on one canvas (1280x720@25) under ONE continuous
synthesized score — the clips' own audio is discarded. A narrator slot is
reserved on the logo card: drop a voice line at VO_PATH ("Solving PI, so you
don't have to.") and re-run; the score ducks under it automatically.

Run: python3 tools/make-film.py
Out: /home/claude/rebuild/solvingpi-promo.mp4
"""
import numpy as np
from scipy.signal import butter, lfilter
import subprocess, wave, os

UP = "/root/.claude/uploads/6687f901-589a-5ab2-b40c-fb5396f70d78"
CLIP1 = os.path.join(UP, "8df043e3-gemini_generated_video_2a0af279.mp4")
CLIP2 = os.path.join(UP, "463ecf73-gemini_generated_video_e68f5651.mp4")
DEMO = "/home/claude/rebuild/solvingpi-trailer.mp4"
CARD = "/home/claude/rebuild/frames/logo-card.png"
VO_PATH = "/home/claude/rebuild/vo.wav"  # optional narrator line
OUT = "/home/claude/rebuild/solvingpi-promo.mp4"
WAV = "/tmp/promo_score.wav"
FPS, FADE = 25, 0.6

D1, D2, D3, D4 = 10.005, 10.005, 32.32, 6.5
o1 = D1 - FADE
o2 = o1 + D2 - FADE
o3 = o2 + D3 - FADE
DUR = o3 + D4
CARD_AT = o3
print(f"timeline: clip2@{o1:.2f} demo@{o2:.2f} logo@{o3:.2f} total {DUR:.2f}s")

# ---------------------------------------------------------------------------
# The score — one piece across all four movements.
# ---------------------------------------------------------------------------
SR = 44100
N = int(SR * (DUR + 0.4))
t = np.arange(N) / SR
music = np.zeros(N)

def env(attack, release, start, length):
    e = np.zeros(N)
    i0, i1 = int(start * SR), min(int((start + length) * SR), N)
    if i1 <= i0: return e
    seg = np.ones(i1 - i0)
    a = min(int(attack * SR), len(seg)); r = min(int(release * SR), len(seg))
    if a: seg[:a] = np.linspace(0, 1, a) ** 2
    if r: seg[-r:] *= np.linspace(1, 0, r) ** 1.5
    e[i0:i1] = seg
    return e

def pad(freq, start, length, amp, detune=0.002):
    out = np.zeros(N)
    for mul, ha in ((1, 1.0), (2, 0.38), (3, 0.16), (4, 0.07)):
        for dt in (-detune, 0.0, detune):
            out += ha * np.sin(2 * np.pi * freq * mul * (1 + dt) * t + hash((mul, dt)) % 7)
    return out * env(2.0, 2.4, start, length) * amp

A2, C3, D3n, E3, F3, G3 = 110.0, 130.81, 146.83, 164.81, 174.61, 196.0
A3, C4, E4, G4, D4n, CS4 = 220.0, 261.63, 329.63, 392.0, 293.66, 277.18
# Movements: sparse dread (spreadsheet) -> open swell (Earth) -> driving body
# (demo) -> resolved home chord with a major-third lift (logo).
CHORDS = [
    (0.0,  6.0,  [A2, E3, A3]),                 # bare fifth — the grind
    (5.0,  6.0,  [F3/2, C3, F3, A3]),           # F under it — weight
    (o1-0.8, 6.5, [C3, G3, C4, E4, G4]),        # Earth reveal — open C
    (o1+5.0, 6.0, [G3/2, D3n, G3, D4n, G4]),    # G — motion
    (o2-0.6, 7.0, [A2, E3, A3, C4, E4]),        # demo begins — Am home
    (o2+6.0, 7.0, [F3/2, C3, F3, A3, C4]),
    (o2+12.5, 7.0, [C3, G3, C4, E4, G4]),
    (o2+19.0, 7.5, [G3/2, D3n, G3, D4n, G4]),
    (o2+25.5, o3-(o2+25.5)+1.2, [F3/2, C3, F3, A3, C4]),
    (o3-0.4, DUR-o3+0.8, [A2, E3, A3, CS4, E4]),  # logo — A MAJOR: arrival
]
for start, length, notes in CHORDS:
    for j, f in enumerate(notes):
        music += pad(f, start, length, amp=0.15 * (1.0 - 0.11 * j))

# Sub-bass pulse — absent in the grind, enters with Earth, drives the demo.
pulse = (0.5 - 0.5 * np.cos(2 * np.pi * 0.25 * t)) ** 2
music += 0.20 * np.sin(2 * np.pi * 55.0 * t) * pulse * env(2.0, 2.0, o1, DUR - o1 - 2.5)

# Ticking unease during the spreadsheet movement only: filtered click at 2Hz.
rng = np.random.default_rng(11)
tick = np.zeros(N)
for k in range(int(o1 * 2)):
    i0 = int(k * 0.5 * SR)
    L = int(0.02 * SR)
    tick[i0:i0+L] += np.hanning(L) * rng.standard_normal(L) * 0.5
b, a = butter(2, [1500/(SR/2), 4000/(SR/2)], "band")
music += 0.10 * lfilter(b, a, tick) * env(0.5, 2.0, 0, o1)

# Booms on every movement change; the logo hit is the big one.
for boom_t, amp in ((0.0, 0.55), (o1, 0.85), (o2, 0.75), (o3, 1.0)):
    i0 = int(boom_t * SR); L = min(int(2.0 * SR), N - i0)
    seg = np.arange(L) / SR
    th = np.sin(2 * np.pi * (50 - 16 * seg) * seg) * np.exp(-3.0 * seg)
    nz = rng.standard_normal(L) * np.exp(-8 * seg) * 0.4
    b, a = butter(2, 380 / (SR / 2), "low")
    music[i0:i0+L] += amp * 0.5 * lfilter(b, a, th + nz)

# Riser through the last demo scenes into the logo hit.
i0 = int((o3 - 7.5) * SR); L = N - i0
segn = rng.standard_normal(L); swept = np.zeros(L); step = SR // 10
for s in range(0, L, step):
    e = min(s + step, L); frac = s / L
    lo = 180 + 2400 * frac ** 2
    b, a = butter(2, [lo/(SR/2), min(lo*2.2, SR/2-100)/(SR/2)], "band")
    swept[s:e] = lfilter(b, a, segn)[s:e]
gate = np.linspace(0, 1, L) ** 2
cut = int((DUR - (o3 - 7.5) - 6.2) * SR)  # riser dies right after the hit
gate[cut:] *= np.linspace(1, 0, L - cut) ** 3
music[i0:] += 0.11 * swept * gate

# Shimmer that blooms with Earth and stays.
music += 0.03 * np.sin(2 * np.pi * E4 * 2 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.29 * t)) * env(3.0, 3.0, o1, DUR - o1)

# Narrator duck window on the logo card (applies whether or not VO exists yet,
# so the v1 cut already breathes where the line will sit).
duck = np.ones(N)
d0, d1 = int((o3 + 0.6) * SR), int(min(o3 + 4.6, DUR) * SR)
r = int(0.35 * SR)
duck[d0:d0+r] = np.linspace(1, 0.45, r); duck[d0+r:d1] = 0.45
duck[d1:d1+r] = np.linspace(0.45, 1, min(r, N - d1))
music *= duck

b, a = butter(1, 7200 / (SR / 2), "low")
music = lfilter(b, a, music)
music[:SR] *= np.linspace(0, 1, SR)
fo = int(2.6 * SR); music[-fo:] *= np.linspace(1, 0, fo) ** 1.2
music /= np.max(np.abs(music)) / 0.80

# Optional narrator line mixed onto the logo card.
if os.path.exists(VO_PATH):
    with wave.open(VO_PATH) as w:
        vosr, ch = w.getframerate(), w.getnchannels()
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32767
    if ch == 2: raw = raw.reshape(-1, 2).mean(axis=1)
    if vosr != SR:
        raw = np.interp(np.arange(int(len(raw) * SR / vosr)) / SR * vosr, np.arange(len(raw)), raw)
    raw /= max(1e-9, np.max(np.abs(raw))) / 0.9
    i0 = int((o3 + 0.8) * SR)
    L = min(len(raw), N - i0)
    music[i0:i0+L] += raw[:L]
    print("narrator line mixed in")
else:
    print("no vo.wav yet — tagline is on-screen text; drop the line at", VO_PATH, "and re-run")

haas = int(0.012 * SR)
stereo = np.stack([music, np.concatenate([np.zeros(haas), music[:-haas]])], axis=1)
with wave.open(WAV, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes())
print(f"score: {DUR:.1f}s")

# ---------------------------------------------------------------------------
# The film.
# ---------------------------------------------------------------------------
card_frames = int(D4 * FPS) + 1
fc = ";".join([
    f"[0:v]fps={FPS},scale=1280:720,format=yuv420p,settb=AVTB[v0]",
    f"[1:v]fps={FPS},scale=1280:720,format=yuv420p,settb=AVTB[v1]",
    # The demo is 1280x800 — letterboxed onto the 16:9 canvas.
    f"[2:v]fps={FPS},scale=1152:720,pad=1280:720:64:0:color=0x05060a,format=yuv420p,settb=AVTB[v2]",
    f"[3:v]scale=1280:720,zoompan=z='min(1.05,1+0.0012*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    f":d={card_frames}:s=1280x720:fps={FPS},format=yuv420p,settb=AVTB[v3]",
    f"[v0][v1]xfade=transition=fade:duration={FADE}:offset={o1:.3f}[x1]",
    f"[x1][v2]xfade=transition=fade:duration={FADE}:offset={o2:.3f}[x2]",
    f"[x2][v3]xfade=transition=fade:duration={FADE}:offset={o3:.3f},fade=t=out:st={DUR-0.7:.2f}:d=0.7[vout]",
])
subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
    "-i", CLIP1, "-i", CLIP2, "-i", DEMO, "-i", CARD, "-i", WAV,
    "-filter_complex", fc, "-map", "[vout]", "-map", "4:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "main", "-level", "4.0", "-preset", "medium", "-crf", "21",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", OUT], check=True)
p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size",
                    "-of", "default=nw=1", OUT], capture_output=True, text=True)
print(p.stdout.strip()); print("promo:", OUT)
