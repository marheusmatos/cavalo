r"""Simula o ESP32: manda blocos de acelerômetro para /api/v1/device/upload.

Rodar de backend/, com o servidor no ar e o sensor vinculado a um cavalo
(PATCH /api/v1/horses/{id} com {"sensor_id": "<mac>"}):

  ..\.venv\Scripts\python sim_sensor.py                    # 10 min sintéticos
  ..\.venv\Scripts\python sim_sensor.py --csv D:\dados.csv  # gravação real

O corpo é o mesmo que o firmware grava no cartão SD (ver main/sensor.py).
"""

import argparse
import math
import random
import time
from array import array

import httpx

from main import sensor
from main.settings import settings

RATE = 50
LSB_PER_G = 4096  # ±8 g


def to_raw(g):
    """g -> int16 do sensor (satura em ±8 g, como o MPU6050)."""
    return max(-32768, min(32767, round(g * LSB_PER_G)))


def header(boot, rate=RATE, lsb_per_g=LSB_PER_G, channels=3):
    return sensor.HEADER.pack(sensor.MAGIC, rate, lsb_per_g, channels, 0, boot)


def record(kind, uptime_ms, dur_ms, values, ch=1):
    """Um registro: `values` é a lista plana de leituras (x, y, z, x, …)."""
    raw = array(sensor.KINDS[kind][0], values).tobytes()
    head = sensor.RECORD.pack(
        ord(kind), 0, len(values) // ch, uptime_ms, dur_ms
    )
    return head + raw


def accel_records(samples, start_ms=0, rate=RATE, block_s=60):
    """Lista plana de x, y, z (int16) -> um registro 'A' por minuto."""
    per_block = rate * block_s * 3
    out = []
    for i in range(0, len(samples), per_block):
        chunk = samples[i : i + per_block]
        dur_ms = len(chunk) // 3 * 1000 // rate
        start_ms += dur_ms
        out.append(record('A', start_ms, dur_ms, chunk, ch=3))
    return out


def synthetic(minutes, rate=RATE):
    """Cavalo parado (1 g em X) com ruído e um trecho agitado por minuto."""
    samples = []
    for i in range(minutes * 60 * rate):
        t = i / rate
        moving = t % 60 > 50  # noqa: PLR2004
        amp = 0.6 if moving else 0.01
        x = 1 + amp * math.sin(t * 9) + random.gauss(0, 0.003)
        y = amp * math.sin(t * 5) + random.gauss(0, 0.003)
        z = amp * math.cos(t * 7) + random.gauss(0, 0.003)
        samples += [to_raw(v) for v in (x, y, z)]
    return samples


def from_csv(path):
    """CSV do CavaloLoggerSD (t_ms, ax_g, ay_g, az_g) -> lista plana int16."""
    samples = []
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                g = [float(v) for v in line.split(',')[1:4]]
            except ValueError:
                continue  # cabeçalho
            if len(g) == 3:  # noqa: PLR2004
                samples += [to_raw(v) for v in g]
    return samples


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--url', default='http://127.0.0.1:8000')
    ap.add_argument('--key', default=settings.SENSOR_KEY)
    ap.add_argument('--sensor', default='f42dc9719d30', help='MAC do ESP32')
    ap.add_argument('--csv', help='gravação do CavaloLoggerSD')
    ap.add_argument('--minutes', type=int, default=10)
    args = ap.parse_args()

    samples = from_csv(args.csv) if args.csv else synthetic(args.minutes)
    records = accel_records(samples)
    boot = random.getrandbits(32)
    # O ESP32 "ligou" há exatamente o tempo coberto pelas leituras.
    uptime_ms = len(samples) // 3 * 1000 // RATE
    t0 = time.perf_counter()
    r = httpx.post(
        f'{args.url}/api/v1/device/upload',
        params={'boot': boot, 'uptime_ms': uptime_ms},
        content=header(boot) + b''.join(records),
        headers={'X-Sensor-Id': args.sensor, 'X-Sensor-Key': args.key},
    )
    ms = (time.perf_counter() - t0) * 1000
    print(
        f'{len(samples) // 3} leituras em {len(records)} blocos '
        f'({len(r.request.content)} bytes): '
        f'HTTP {r.status_code} em {ms:.0f} ms -> {r.text}'
    )


if __name__ == '__main__':
    main()
