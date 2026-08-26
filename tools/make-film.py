#!/usr/bin/env python3
"""The promo film, five movements on one 1280x720@25 canvas:

  I   the spreadsheet grind        (Gemini clip, 10s)
  II  the player at 2 AM           (Gemini clip, 10s)
  III Earth — the scale of it      (Gemini clip, 10s)
  IV  the product demo             (32s, supersampled zoom = no judder)
  V   the Solving PI logo card     (6.5s)

AUDIO: one continuous synthesized score across the whole film, with each
Gemini clip's OWN audio mixed on top during its movement (faded at the video
crossfades). The demo keeps the unified score only. A full narration track
can be dropped at VO_PATH (timed to the script; see the promo script file) —
the score pre-ducks under every scripted line so the mix already breathes.

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
DEMO = "/home/claude/rebuild/solvingpi-trailer.mp4"
CARD = "/home/claude/rebuild/frames/logo-card.png"
VO_PATH = "/home/claude/rebuild/vo.wav"
OUT = "/home/claude/rebuild/solvingpi-promo.mp4"
WAV = "/tmp/promo_score.wav"
FPS, FADE = 25, 0.6

D1 = D2 = D3 = 10.005
D4, D5 = 32.32, 6.5
oA = D1 - FADE                 # player in
oB = oA + D2 - FADE            # earth in
oC = oB + D3 - FADE            # demo in
oD = oC + D4 - FADE            # logo in
DUR = oD + D5
print(f"timeline: player@{oA:.2f} earth@{oB:.2f} demo@{oC:.2f} logo@{oD:.2f} total {DUR:.2f}s")

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
A3, C4, E4, G4, D4n, CS4, B3 = 220.0, 261.63, 329.63, 392.0, 293.66, 277.18, 246.94
CHORDS = [
    # I — the grind: a bare, cold fifth.
    (0.0,  6.2,  [A2, E3, A3]),
    (5.2,  5.6,  [F3/2, C3, F3]),
    # II — the player: the minor third arrives; it gets personal.
    (oA-0.6, 5.6, [A2, E3, A3, C4]),
    (oA+4.6, 5.6, [D3n/2, A2, D3n, F3]),          # Dm — heavier
    # III — Earth: the chord opens wide.
    (oB-0.8, 6.0, [C3, G3, C4, E4, G4]),
    (oB+4.8, 5.6, [G3/2, D3n, G3, D4n, G4]),
    # IV — the demo: driving Am body.
    (oC-0.6, 7.0, [A2, E3, A3, C4, E4]),
    (oC+6.0, 7.0, [F3/2, C3, F3, A3, C4]),
    (oC+12.5, 7.0, [C3, G3, C4, E4, G4]),
    (oC+19.0, 7.5, [G3/2, D3n, G3, D4n, G4]),
    (oC+25.5, oD-(oC+25.5)+1.2, [F3/2, C3, F3, A3, C4]),
    # V — arrival: A MAJOR.
    (oD-0.4, DUR-oD+0.8, [A2, E3, A3, CS4, E4]),
]
for start, length, notes in CHORDS:
    for j, f in enumerate(notes):
        music += pad(f, start, length, amp=0.15 * (1.0 - 0.11 * j))

# Sub-bass: hinted during the player, full from Earth onward.
pulse = (0.5 - 0.5 * np.cos(2 * np.pi * 0.25 * t)) ** 2
music += 0.08 * np.sin(2 * np.pi * 55.0 * t) * pulse * env(2.5, 1.0, oA, oB - oA)
music += 0.20 * np.sin(2 * np.pi * 55.0 * t) * pulse * env(2.0, 2.0, oB, DUR - oB - 2.5)

# The clock-tick of the grind, persisting (fainter) while the player suffers.
rng = np.random.default_rng(11)
tick = np.zeros(N)
for k in range(int(oB * 2)):
    i0 = int(k * 0.5 * SR); L = int(0.02 * SR)
    tick[i0:i0+L] += np.hanning(L) * rng.standard_normal(L) * 0.5
b, a = butter(2, [1500/(SR/2), 4000/(SR/2)], "band")
music += lfilter(b, a, tick) * (0.10 * env(0.5, 1.0, 0, oA) + 0.05 * env(0.5, 2.0, oA, oB - oA))

# Booms on the movement turns.
for boom_t, amp in ((0.0, 0.5), (oA, 0.55), (oB, 0.9), (oC, 0.75), (oD, 1.0)):
    i0 = int(boom_t * SR); L = min(int(2.0 * SR), N - i0)
    seg = np.arange(L) / SR
    th = np.sin(2 * np.pi * (50 - 16 * seg) * seg) * np.exp(-3.0 * seg)
    nz = rng.standard_normal(L) * np.exp(-8 * seg) * 0.4
    b, a = butter(2, 380 / (SR / 2), "low")
    music[i0:i0+L] += amp * 0.5 * lfilter(b, a, th + nz)

# Riser into the logo hit.
i0 = int((oD - 7.5) * SR); L = N - i0
segn = rng.standard_normal(L); swept = np.zeros(L); step = SR // 10
for s in range(0, L, step):
    e = min(s + step, L); frac = s / L
    lo = 180 + 2400 * frac ** 2
    b, a = butter(2, [lo/(SR/2), min(lo*2.2, SR/2-100)/(SR/2)], "band")
    swept[s:e] = lfilter(b, a, segn)[s:e]
gate = np.linspace(0, 1, L) ** 2
cut = int((DUR - (oD - 7.5) - 6.2) * SR)
gate[cut:] *= np.linspace(1, 0, L - cut) ** 3
music[i0:] += 0.11 * swept * gate

# Shimmer from Earth onward.
music += 0.03 * np.sin(2 * np.pi * E4 * 2 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.29 * t)) * env(3.0, 3.0, oB, DUR - oB)

# ---------------------------------------------------------------------------
# Source audio from the three Gemini clips, faded at the video crossfades.
# ---------------------------------------------------------------------------
def clip_audio(path):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path,
                    "-ac", "1", "-ar", str(SR), tmp], check=True)
    with wave.open(tmp) as w:
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32767
    os.unlink(tmp)
    return raw

for path, start, dur in ((CLIP1, 0.0, D1), (CLIP2, oA, D2), (CLIP3, oB, D3)):
    raw = clip_audio(path)
    L = min(len(raw), int(dur * SR))
    seg = raw[:L].copy()
    f = int(FADE * SR)
    seg[:f] *= np.linspace(0, 1, f)
    seg[-f:] *= np.linspace(1, 0, f)
    peak = np.max(np.abs(seg))
    if peak > 1e-6: seg *= min(1.0, 0.5 / peak)   # sit UNDER the score bed
    i0 = int(start * SR)
    music[i0:i0+L] += seg

# ---------------------------------------------------------------------------
# Narration: score pre-ducks under every scripted line (see the script file),
# so the mix breathes even before the voice track exists.
# ---------------------------------------------------------------------------
VO_WINDOWS = [   # (start, end, floor)
    (2.0, 8.5, 0.60),          # "Every week... somebody opens the spreadsheet."
    (oA + 1.5, oA + 8.0, 0.60),  # "...it stops being a game."
    (oB + 1.5, oB + 7.5, 0.60),  # "But what if the numbers ran themselves?"
    (oC + 1.5, oC + 5.0, 0.65),  # "One question. Every answer."
    (oD + 0.6, oD + 4.6, 0.45),  # "Solving PI... so you don't have to."
]
duck = np.ones(N)
r = int(0.35 * SR)
for w0, w1, floor in VO_WINDOWS:
    d0, d1 = int(w0 * SR), int(min(w1, DUR) * SR)
    duck[d0:d0+r] = np.minimum(duck[d0:d0+r], np.linspace(1, floor, r))
    duck[d0+r:d1] = np.minimum(duck[d0+r:d1], floor)
    duck[d1:d1+r] = np.minimum(duck[d1:d1+r], np.linspace(floor, 1, min(r, N - d1)))
music *= duck

b, a = butter(1, 7200 / (SR / 2), "low")
music = lfilter(b, a, music)
music[:SR] *= np.linspace(0, 1, SR)
fo = int(2.6 * SR); music[-fo:] *= np.linspace(1, 0, fo) ** 1.2
music /= np.max(np.abs(music)) / 0.80

if os.path.exists(VO_PATH):
    with wave.open(VO_PATH) as w:
        vosr, ch = w.getframerate(), w.getnchannels()
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32767
    if ch == 2: raw = raw.reshape(-1, 2).mean(axis=1)
    if vosr != SR:
        raw = np.interp(np.arange(int(len(raw) * SR / vosr)) / SR * vosr, np.arange(len(raw)), raw)
    raw /= max(1e-9, np.max(np.abs(raw))) / 0.9
    L = min(len(raw), N)
    music[:L] += raw[:L]
    print("narration mixed in from", VO_PATH)
else:
    print("no vo.wav yet — record the script's lines to its timecodes and drop the file at", VO_PATH)

haas = int(0.012 * SR)
stereo = np.stack([music, np.concatenate([np.zeros(haas), music[:-haas]])], axis=1)
music_pk = np.max(np.abs(stereo))
if music_pk > 0.98: stereo *= 0.98 / music_pk
with wave.open(WAV, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes())
print(f"score+mix: {DUR:.1f}s")

# ---------------------------------------------------------------------------
# The film.
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
