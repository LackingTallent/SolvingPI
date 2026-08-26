#!/usr/bin/env python3
"""Trailer assembly: 16 chosen walkthrough frames -> ~33s film with slow
zoom (Ken Burns), 0.45s crossfades, and an original synthesized epic-space
score (fully license-free — every sample is generated here).

Run after tools/walkthrough.mjs has filled ../frames:
    python3 tools/make-trailer.py
Output: /home/claude/rebuild/solvingpi-trailer.mp4
"""
import numpy as np
from scipy.signal import butter, lfilter
import subprocess, wave, os

FRAMES = "/home/claude/rebuild/frames"
OUT = "/home/claude/rebuild/solvingpi-trailer.mp4"
WAV = "/tmp/epic_space.wav"
FPS = 25
FADE = 0.45

# (frame, seconds on screen) — the tight cut of the tour.
SCENES = [
    ("f01.png", 3.0),  # hero / title
    ("f02.png", 2.4),  # what do you want?
    ("f03.png", 2.2),  # goal picked -> product appears
    ("f05.png", 2.2),  # quick estimate + space band
    ("f06.png", 2.2),  # suggested sourcing
    ("f07.png", 2.0),  # characters
    ("f09.png", 2.2),  # planets
    ("f10.png", 2.2),  # costs presets
    ("f11.png", 2.6),  # solve + estimate banner
    ("f12.png", 2.2),  # output/net/quality cards
    ("f13.png", 2.8),  # character dashboard
    ("f14.png", 2.4),  # one-click templates
    ("f15.png", 2.2),  # ledger
    ("f20.png", 2.5),  # compare ranked
    ("f21.png", 2.5),  # plan this -> best path
    ("f24.png", 3.4),  # outro
]

# ---------------------------------------------------------------------------
# 1. The score. A-minor epic: layered pad chords, sub-bass pulse, deep booms
#    on scene-group boundaries, a rising noise sweep into the finale.
# ---------------------------------------------------------------------------
SR = 44100

def video_duration():
    total, off = SCENES[0][1], 0.0
    for _, d in SCENES[1:]:
        off = total - FADE
        total = off + d
    return total

DUR = video_duration()
N = int(SR * (DUR + 0.5))
t = np.arange(N) / SR

def env(attack, release, start, length):
    """Slow-attack pad envelope on the global timeline."""
    e = np.zeros(N)
    i0, i1 = int(start * SR), min(int((start + length) * SR), N)
    if i1 <= i0:
        return e
    seg = np.ones(i1 - i0)
    a = min(int(attack * SR), len(seg))
    r = min(int(release * SR), len(seg))
    if a > 0:
        seg[:a] = np.linspace(0, 1, a) ** 2
    if r > 0:
        seg[-r:] *= np.linspace(1, 0, r) ** 1.5
    e[i0:i1] = seg
    return e

def pad_note(freq, start, length, amp=1.0, detune=0.002):
    """Warm pad voice: few soft harmonics, chorus detune, slow envelope."""
    out = np.zeros(N)
    for mul, ha in ((1, 1.0), (2, 0.38), (3, 0.16), (4, 0.07)):
        for dt in (-detune, 0.0, detune):
            f = freq * mul * (1 + dt)
            out += ha * np.sin(2 * np.pi * f * t + hash((mul, dt)) % 7)
    return out * env(2.2, 2.6, start, length) * amp

A2, C3, D3, E3, F3, G3 = 110.0, 130.81, 146.83, 164.81, 174.61, 196.0
A3, C4, E4, F4, G4, D4 = 220.0, 261.63, 329.63, 349.23, 392.0, 293.66
# i – VI – III – VII in A minor, two passes across the film.
PROG = [
    (0.00, [A2, E3, A3, C4, E4]),        # Am
    (8.20, [F3 / 2, C3, F3, A3, C4]),    # F
    (16.4, [C3, G3, C4, E4, G4]),        # C
    (24.6, [G3 / 2, D3, G3, D4, G4]),    # G — the lift into the finale
]
music = np.zeros(N)
for k, (start, notes) in enumerate(PROG):
    length = (PROG[k + 1][0] - start + 2.5) if k + 1 < len(PROG) else DUR - start + 0.4
    for j, f in enumerate(notes):
        music += pad_note(f, start, length, amp=0.16 * (1.0 - 0.12 * j))

# Sub-bass heartbeat: root an octave down, swelling twice per chord.
for k, (start, notes) in enumerate(PROG):
    root = notes[0] / 2
    length = (PROG[k + 1][0] - start) if k + 1 < len(PROG) else DUR - start
    pulse = (0.5 - 0.5 * np.cos(2 * np.pi * 0.24 * (t - start))) ** 2
    music += 0.22 * np.sin(2 * np.pi * root * t) * pulse * env(0.8, 1.2, start, length)

# Deep cinematic booms at the act turns.
rng = np.random.default_rng(7)
for boom_t, amp in ((0.0, 0.8), (8.2, 0.7), (16.4, 0.75), (24.6, 0.95)):
    i0 = int(boom_t * SR)
    L = int(1.8 * SR)
    if i0 + L > N:
        L = N - i0
    seg = np.arange(L) / SR
    thump = np.sin(2 * np.pi * (52 - 18 * seg) * seg) * np.exp(-3.2 * seg)
    nz = rng.standard_normal(L) * np.exp(-9 * seg) * 0.4
    b, a = butter(2, 400 / (SR / 2), "low")
    music[i0:i0 + L] += amp * 0.5 * lfilter(b, a, thump + nz)

# Shimmer: quiet high fifth with slow tremolo, fades in over the film.
music += 0.035 * np.sin(2 * np.pi * E4 * 2 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.31 * t)) * (t / DUR)

# Riser into the outro: band-swept noise climbing for the last ~7s of scenes.
rise_start = DUR - 10.0
i0 = int(rise_start * SR)
L = N - i0
seg = np.arange(L) / SR
noise = rng.standard_normal(L)
swept = np.zeros(L)
step = SR // 10
for s in range(0, L, step):
    e = min(s + step, L)
    frac = s / L
    lo = 200 + 2200 * frac ** 2
    b, a = butter(2, [lo / (SR / 2), min(lo * 2.2, SR / 2 - 100) / (SR / 2)], "band")
    swept[s:e] = lfilter(b, a, noise)[s:e]
music[i0:] += 0.10 * swept * np.linspace(0, 1, L) ** 2 * np.concatenate(
    [np.ones(L - int(3.2 * SR)), np.linspace(1, 0, int(3.2 * SR))])

# Master: gentle lowpass polish, fades, stereo width via haas offset.
b, a = butter(1, 7000 / (SR / 2), "low")
music = lfilter(b, a, music)
fade_in = int(1.0 * SR)
music[:fade_in] *= np.linspace(0, 1, fade_in)
fade_out = int(2.8 * SR)
music[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.2
music /= np.max(np.abs(music)) / 0.82
haas = int(0.012 * SR)
left = music
right = np.concatenate([np.zeros(haas), music[:-haas]])
stereo = np.stack([left, right], axis=1)
pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
with wave.open(WAV, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"score: {DUR:.1f}s written")

# ---------------------------------------------------------------------------
# 2. The film: zoompan per scene, xfade chain, mux with the score.
# ---------------------------------------------------------------------------
inputs, filters = [], []
for i, (f, d) in enumerate(SCENES):
    inputs += ["-i", os.path.join(FRAMES, f)]
    frames = int(d * FPS) + 1
    # Slow push-in (outro pulls back out instead).
    zexpr = "'min(1.042,1+0.0011*on)'" if f != "f24.png" else "'max(1.0,1.04-0.0011*on)'"
    filters.append(
        f"[{i}:v]scale=1280:800,zoompan=z={zexpr}"
        f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1280x800:fps={FPS},"
        f"format=yuv420p,settb=AVTB[v{i}]")
crossfades, total = [], SCENES[0][1]
prev = "v0"
for i in range(1, len(SCENES)):
    off = total - FADE
    out = f"x{i}" if i < len(SCENES) - 1 else "vout"
    crossfades.append(f"[{prev}][v{i}]xfade=transition=fade:duration={FADE}:offset={off:.3f}[{out}]")
    prev = out
    total = off + SCENES[i][1]
fc = ";".join(filters + crossfades)
cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs, "-i", WAV,
       "-filter_complex", fc, "-map", "[vout]", "-map", f"{len(SCENES)}:a",
       "-c:v", "libx264", "-preset", "medium", "-crf", "22",
       "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", OUT]
subprocess.run(cmd, check=True)
probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size",
                        "-of", "default=nw=1", OUT], capture_output=True, text=True)
print(probe.stdout.strip())
print("trailer:", OUT)
