# arcvoice — the on-device half of "OpenGotchi Jobs on Arc" (448x368 AMOLED).
# Tap the pet, speak, and the pet agent on your LAN commissions an ERC-8183 job
# on Arc. Audio goes to the agent over plain HTTP (no hosted voice API):
#   POST {AGENT}/voice/stt   raw PCM16 16 kHz mono  -> {"text": ...}
#   GET  {AGENT}/voice/tts?t= URL-encoded text       -> raw PCM16 16 kHz (streamed)
# Agent-topic directives via mqtt.recv():
#   data <key> <value>   status/step/skill/price/job/tx/balance/today/result/ask
#   speak <text>         fetch TTS from the agent and play it
#   note <text>          toast
# Visual language follows the gotchiOS token sheet: dark-only AMOLED, violet
# gradient accents, Space Grotesk / Plex faces, 20-24 px radii, milady eyes.
import display, touch, buttons, time, gc, system, mqtt, audio, http, math

AGENT = "__AGENT_URL__"
W, H = display.WIDTH, display.HEIGHT

# ── tokens ───────────────────────────────────────────────────────────
def C(h): return display.color((h >> 16) & 255, (h >> 8) & 255, h & 255)
BG, S1, S2, HAIR = C(0x000000), C(0x14161C), C(0x1D2028), C(0x2A2E38)
VIO, VIO_A, VIO_B, VIO_SOFT, TINT = C(0x8B5CF6), C(0xA78BFA), C(0x7C3AED), C(0xC4B5FD), C(0x1B1530)
T1, T2, T3 = C(0xF2F4F8), C(0x9AA1AF), C(0x5C6370)
INFO, OK, WARN, CRIT = C(0x38BDF8), C(0x34D399), C(0xFBBF24), C(0xF87171)
F_EYEBROW, F_TITLE, F_HERO, F_BODY, F_CAP, F_MONO, F_SMALL = display.SG12, display.SG22, display.SG28, display.P16, display.P13, display.M12, display.P11

# ── layout ───────────────────────────────────────────────────────────
BAR_H = 30
SHEET_Y = 196
RING_CX, RING_CY, RING_R = 338, 112, 54
EYE_W, EYE_H, EYE_X, EYE_Y = 168, 88, 36, 66
NODES = 6                       # one per Arc transaction in a job
STEPS = ('creating job', 'quoting', 'funding', 'delivering', 'settling', 'feedback')

# ── state ────────────────────────────────────────────────────────────
data = {}
state = 'idle'                  # idle | listen | think | working
frame = 0
heard = ''
err = ''
toast = ''
toast_until = 0
levels = [0] * 28               # live mic bars
done_nodes = 0
burst_until = 0
last_tap = 0
_eyes = {}

SIN = [math.sin(i * math.pi / 30) for i in range(60)]
COS = [math.cos(i * math.pi / 30) for i in range(60)]

# On-device WakeNet ("Jarvis"). The detector and the recorder cannot share
# the mic, so it is disarmed while we record or play and re-armed after.
try:
    WAKE = bool(audio.wake_ready())
except Exception:
    WAKE = False
wake_on = False


def wake_arm():
    global wake_on
    if WAKE and not wake_on:
        try:
            wake_on = bool(audio.wake_start())
        except Exception:
            wake_on = False


def wake_disarm():
    global wake_on
    if WAKE and wake_on:
        try:
            audio.wake_stop()
        except Exception:
            pass
        wake_on = False


def eyes(name):
    if name in _eyes:
        return _eyes[name]
    d = None
    try:
        d = system.eye_data(name + '_168x88.bin')
        if not d:
            d = system.readbytes('/littlefs/apps/eyes/sm/' + name + '_168x88.bin')
    except Exception:
        d = None
    if len(_eyes) < 4:
        _eyes[name] = d
    return d


def emotion():
    st = data.get('status', '')
    if state == 'think':
        return 'EyesSpiral'
    if st == 'paid':
        return 'EyesHeart'
    if st == 'declined':
        return 'EyesSleepy'
    if st == 'failed':
        return 'EyesTeary'
    if state == 'idle' and (frame % 90) in (0, 1):
        return 'EyesClosed'
    return 'EyesClassic'


def wrap(t, font, maxw):
    out, line = [], ''
    for w in t.split():
        cand = (line + ' ' + w).strip()
        if display.fwidth(cand, font) <= maxw:
            line = cand
        else:
            if line:
                out.append(line)
            line = w
    if line:
        out.append(line)
    return out


def chip(x, y, text, font, fg, bg, pad=10):
    w = display.fwidth(text, font) + 2 * pad
    h = display.fline(font) + 8
    display.rrect(x, y, w, h, h // 2, bg)
    display.ftext(x + pad, y + 4, text, font, fg)
    return w + 8


def dot_chip(x, y, text, col):
    w = display.fwidth(text, F_CAP) + 30
    h = display.fline(F_CAP) + 8
    display.rrect_a(x, y, w, h, h // 2, col, 40)
    display.circle_filled(x + 12, y + h // 2, 3, col)
    display.ftext(x + 22, y + 4, text, F_CAP, col)
    return w + 8


# ── chrome ───────────────────────────────────────────────────────────
def draw_bar():
    st = data.get('status', '')
    col = VIO if state != 'listen' else INFO
    display.circle_filled(22, BAR_H // 2, 4, col)
    # close target: tap the corner (or press BOOT) to leave the app
    display.rrect(W - 34, 6, 26, 18, 9, S2)
    display.ftext(W - 26, 8, 'x', F_MONO, T2)
    display.ftext(34, 9, 'OPENGOTCHI  ·  ARC', F_EYEBROW, T2, 25)
    bal = data.get('balance', '')
    if bal:
        t = bal + ' USDC'
        w = display.fwidth(t, F_MONO) + 20
        display.rrect(W - 44 - w, 6, w, 18, 9, S2)
        display.ftext(W - 34 - w, 8, t, F_MONO, T2)
    elif st == 'working':
        display.ftext(W - 44 - display.fwidth('WORKING', F_EYEBROW, 25), 9, 'WORKING', F_EYEBROW, VIO_SOFT, 25)
    elif wake_on and state == 'idle':
        t = 'SAY JARVIS'
        display.ftext(W - 44 - display.fwidth(t, F_EYEBROW, 25), 9, t, F_EYEBROW, T3, 25)


def draw_eyes():
    d = eyes(emotion())
    if d:
        display.gray4(EYE_X, EYE_Y, EYE_W, EYE_H, d, T1, BG)
    else:
        display.circle_filled(EYE_X + 50, EYE_Y + 44, 22, T1)
        display.circle_filled(EYE_X + 118, EYE_Y + 44, 22, T1)
        display.circle_filled(EYE_X + 54, EYE_Y + 46, 10, VIO)
        display.circle_filled(EYE_X + 122, EYE_Y + 46, 10, VIO)


def draw_ring():
    """Six orbital nodes = the six Arc transactions of one job."""
    st = data.get('status', '')
    working = st == 'working'
    rot = (frame * (3 if working else 1)) % 60
    display.circle(RING_CX, RING_CY, RING_R, HAIR)
    display.circle(RING_CX, RING_CY, RING_R + 1, HAIR)
    for i in range(NODES):
        a = (i * 10 + rot) % 60
        x = int(RING_CX + RING_R * COS[a])
        y = int(RING_CY + RING_R * SIN[a])
        if i < done_nodes:
            display.circle_filled(x, y, 8, TINT)
            display.circle_filled(x, y, 5, VIO_A if (frame + i * 7) % 14 < 7 else VIO)
        elif working and i == done_nodes:
            r = 4 + (frame // 3) % 3
            display.circle_filled(x, y, r, VIO_SOFT)
        else:
            display.circle_filled(x, y, 3, S2)
            display.circle(x, y, 3, HAIR)
    if working:
        # comet with a fading tail
        for k in range(4):
            a = (rot * 2 - k * 3) % 60
            x = int(RING_CX + (RING_R + 12) * COS[a])
            y = int(RING_CY + (RING_R + 12) * SIN[a])
            display.circle_filled(x, y, 5 - k, (VIO_SOFT, VIO_A, VIO, VIO_B)[k])
    elif state == 'listen':
        lv = levels[-1]
        display.circle(RING_CX, RING_CY, RING_R - 8 - (lv * 30) // 32768, INFO)
    # centre label
    if st == 'paid':
        t = 'SETTLED'
        col = OK
    elif st == 'declined':
        t = 'HELD'
        col = WARN
    elif st == 'failed':
        t = 'FAILED'
        col = CRIT
    elif working:
        t = data.get('job', '') or 'ARC'
        col = VIO_SOFT
    else:
        t = 'ARC'
        col = T3
    display.ftext(RING_CX - display.fwidth(t, F_TITLE) // 2, RING_CY - 12, t, F_TITLE, col)
    if frame < burst_until:
        k = burst_until - frame        # 40..1
        rr = RING_R + (40 - k) * 4
        for i in range(0, 60, 5):
            x = int(RING_CX + rr * COS[(i + frame) % 60])
            y = int(RING_CY + rr * SIN[(i + frame) % 60])
            display.circle_filled(x, y, 2 if k > 20 else 1, OK if i % 10 else VIO_SOFT)


def draw_waveform(y0, h):
    n = len(levels)
    bw = 8
    x = (W - n * (bw + 4)) // 2
    for i, lv in enumerate(levels):
        bh = 4 + (lv * (h - 4)) // 32768
        if bh > h:
            bh = h
        col = VIO_A if i > n * 2 // 3 else (VIO if i > n // 3 else VIO_B)
        display.rrect(x, y0 + (h - bh) // 2, bw, bh, 4, col)
        x += bw + 4


def draw_sheet():
    st = data.get('status', '')
    display.rrect(0, SHEET_Y, W, H - SHEET_Y + 40, 24, S1)
    display.rrect_line(0, SHEET_Y, W, H - SHEET_Y + 40, 24, HAIR)
    x0, y = 24, SHEET_Y + 20
    maxw = W - 48
    if state == 'listen':
        draw_waveform(y, 56)
        y += 70
        display.ftext(x0, y, 'listening', F_TITLE, T1)
        secs = '%d.%ds' % (data.get('_ms', 0) // 1000, (data.get('_ms', 0) % 1000) // 100)
        display.ftext(W - 24 - display.fwidth(secs, F_MONO), y + 6, secs, F_MONO, T3)
        display.ftext(x0, y + 32, 'stop talking and I will send it to the agent', F_CAP, T2)
    elif state == 'think':
        display.ftext(x0, y, 'transcribing' + '.' * (1 + (frame // 8) % 3), F_TITLE, T1)
        sx = x0 + (frame * 9) % (maxw - 120)
        display.rrect(x0, y + 44, maxw, 6, 3, S2)
        display.rrect_grad(sx, y + 44, 120, 6, 3, VIO_A, VIO_B)
        display.ftext(x0, y + 66, 'whisper on your laptop, over your wifi', F_CAP, T2)
    elif st == 'working':
        lines = wrap('"' + (heard or data.get('ask', '')) + '"', F_BODY, maxw)[:2]
        for ln in lines:
            display.ftext(x0, y, ln, F_BODY, T1); y += display.fline(F_BODY)
        y += 10
        x = x0
        if data.get('skill'): x += chip(x, y, data['skill'], F_CAP, VIO_SOFT, TINT)
        if data.get('price'): x += chip(x, y, data['price'] + ' USDC', F_MONO, T2, S2)
        if data.get('job'): x += chip(x, y, data['job'], F_MONO, T2, S2)
        y += 38
        step = data.get('step', '')
        display.ftext(x0, y, step + '.' * (1 + (frame // 8) % 3), F_CAP, VIO_SOFT)
        if data.get('tx'):
            display.ftext(W - 24 - display.fwidth(data['tx'], F_MONO), y, data['tx'], F_MONO, T3)
    elif st in ('paid', 'declined', 'failed'):
        col = OK if st == 'paid' else (WARN if st == 'declined' else CRIT)
        lines = wrap(data.get('result', ''), F_BODY, maxw)[:3]
        for ln in lines:
            display.ftext(x0, y, ln, F_BODY, T1); y += display.fline(F_BODY)
        y += 8
        x = x0
        x += dot_chip(x, y, 'settled on Arc' if st == 'paid' else ('held by policy' if st == 'declined' else 'failed'), col)
        if data.get('job'): x += chip(x, y, data['job'], F_MONO, T2, S2)
        if data.get('price') and st == 'paid': x += chip(x, y, data['price'] + ' USDC', F_MONO, T2, S2)
        if data.get('tx') and st == 'paid': x += chip(x, y, data['tx'], F_MONO, T3, S2)
        display.ftext(x0, H - 30, 'today ' + data.get('today', '-') + ' USDC', F_SMALL, T3)
        t = 'tap to ask again'
        display.ftext(W - 24 - display.fwidth(t, F_CAP), H - 32, t, F_CAP, T2)
    else:
        display.ftext(x0, y, 'Hire an agent on Arc', F_HERO, T1)
        y += 40
        tick = 'weather in a city   ·   a crypto price   ·   the top headline   ·   a snack   ·   your fortune   ·   '
        tw = display.fwidth(tick, F_CAP)
        off = (frame * 2) % tw
        display.ftext(x0 - off, y, tick + tick, F_CAP, T2)
        display.rect_filled(0, y - 2, x0, 24, S1)
        display.rect_filled(W - 24, y - 2, 24, 24, S1)
        y += 34
        if heard:
            display.ftext(x0, y, 'last: ' + heard, F_SMALL, T3)
        if err:
            display.ftext(x0, y, err, F_SMALL, CRIT)
        t = 'say Jarvis or tap' if wake_on else 'tap to talk'
        pw = display.fwidth(t, F_CAP) + 28
        display.rrect_grad(W - 24 - pw, H - 40, pw, 30, 15, VIO_A, VIO_B)
        display.ftext(W - 24 - pw + 14, H - 36, t, F_CAP, T1)
        display.ftext(x0, H - 30, 'swipe down to exit', F_SMALL, T3)
    if toast and frame < toast_until:
        tw = display.fwidth(toast, F_CAP) + 28
        display.rrect(W // 2 - tw // 2, H - 44, tw, 28, 14, S2)
        display.ftext(W // 2 - tw // 2 + 14, H - 40, toast, F_CAP, T1)


def draw():
    display.clear(BG)
    draw_bar()
    draw_eyes()
    draw_ring()
    draw_sheet()
    display.flush()


# ── voice ────────────────────────────────────────────────────────────
def urlq(s):
    out = ''
    for ch in s:
        o = ord(ch)
        if (48 <= o <= 57) or (65 <= o <= 90) or (97 <= o <= 122) or ch in '-_.':
            out += ch
        elif ch == ' ':
            out += '+'
        else:
            out += '%%%02X' % o
    return out


def set_toast(t, frames=70):
    global toast, toast_until
    toast = t
    toast_until = frame + frames


def say_local(text):
    carry = [b'']

    def feed(chunk):
        buf = carry[0] + chunk
        n = len(buf) & ~1
        if n:
            audio.play(buf[:n], 16000)
        carry[0] = buf[n:]
        return True
    wake_disarm()
    try:
        audio.volume(85)
        st = http.stream(AGENT + '/voice/tts?t=' + urlq(text), feed, None, 60000)
        if st != 200:
            set_toast('tts http %d' % st)
    except Exception as e:
        set_toast('tts: ' + repr(e)[:30])
    wake_arm()


def peak(buf, n):
    m = 0
    for i in range(0, n - 1, 32):
        s = buf[i] | (buf[i + 1] << 8)
        if s >= 32768:
            s = 65536 - s
        if s > m:
            m = s
    return m


def listen():
    """Background recorder (8 kHz PCM16 ring, same path the firmware's own
    voice app uses after a wake hit) with a live waveform; stops on silence."""
    global state, heard, err, frame
    state = 'listen'
    err = ''
    wake_disarm()
    for i in range(len(levels)):
        levels[i] = 0
    data['_ms'] = 0
    draw()
    try:
        audio.tone(1300, 50, 55)
    except Exception:
        pass
    if audio.rec_running():
        audio.rec_stop()
    if not audio.rec_start(16000, 12, False):
        err = 'mic busy'
        state = 'idle'
        wake_arm()
        return
    chunk = bytearray(1600)
    pcm = bytearray()
    floor = 32767
    thr = 900
    spoke = False
    quiet = 0
    ms = 0
    t0 = time.ticks_ms()
    try:
        while ms < 7000:
            time.sleep_ms(50)
            ms = time.ticks_diff(time.ticks_ms(), t0)
            if buttons.any():
                break
            while audio.rec_available() >= len(chunk):
                n = audio.rec_read_into(chunk, 0)
                if n <= 0:
                    break
                pcm += chunk[:n]
            lv = audio.rec_level()
            if ms <= 300:
                if lv < floor:
                    floor = lv
                thr = floor * 3 + 350
            levels.pop(0)
            levels.append(lv)
            if lv > thr:
                spoke = True
                quiet = 0
            elif spoke:
                quiet += 50
            if spoke and quiet >= 800 and ms >= 1200:
                break
            if ms >= 4000 and not spoke:
                break
            if ms % 150 < 50:
                data['_ms'] = ms
                frame += 1
                draw()
        while audio.rec_available() > 0:
            n = audio.rec_read_into(chunk, 0)
            if n <= 0:
                break
            pcm += chunk[:n]
    finally:
        audio.rec_stop()
    state = 'think'
    draw()
    if not spoke or len(pcm) < 8000:
        err = 'heard nothing, say Jarvis or tap'
        state = 'idle'
        wake_arm()
        return
    try:
        code, body = http.request('POST', AGENT + '/voice/stt', {'Content-Type': 'application/octet-stream', 'X-Sample-Rate': '8000'}, pcm, 60000)
    except Exception as e:
        code, body = 0, repr(e)
    pcm = None
    gc.collect()
    if code == 200:
        b = body.decode() if isinstance(body, bytes) else str(body)
        i = b.find('"text":"')
        heard = b[i + 8:b.find('"', i + 8)] if i >= 0 else ''
        if heard:
            data.clear()
            data['status'] = 'working'
            data['ask'] = heard
            data['step'] = 'agent is planning'
            state = 'working'
            wake_arm()
            return
        err = 'heard nothing, say Jarvis or tap'
    else:
        err = 'agent unreachable (http %d)' % code
    state = 'idle'
    wake_arm()


# ── directives ───────────────────────────────────────────────────────
def apply(k, v):
    global state, done_nodes, burst_until
    data[k] = v
    if k == 'status':
        if v == 'working':
            done_nodes = 0
        elif v == 'paid':
            done_nodes = NODES
            burst_until = frame + 40
            state = 'idle'
        elif v in ('declined', 'failed'):
            state = 'idle'
    elif k == 'step':
        if 'quoting' in v: done_nodes = 1
        elif 'funding' in v: done_nodes = 2
        elif 'doing the job' in v: done_nodes = 3
        elif 'verifying' in v: done_nodes = 4
        elif 'settled' in v: done_nodes = 5


def handle(m):
    if m.startswith('data '):
        p = m.split(' ', 2)
        if len(p) == 3:
            apply(p[1], p[2])
    elif m.startswith('rcpt '):
        # one message: k<US>v<RS>k<US>v ... status applied last so the
        # screen flips only once every field is in place
        status = None
        for kv in m[5:].split('\x1e'):
            i = kv.find('\x1f')
            if i > 0:
                k, v = kv[:i], kv[i + 1:]
                if k == 'status':
                    status = v
                else:
                    apply(k, v)
        if status is not None:
            apply('status', status)
            mqtt.send_command('evt|shell|rcpt:' + status)
    elif m.startswith('speak '):
        draw()
        say_local(m[6:])
    elif m.startswith('note '):
        set_toast(m[5:])
    elif m == 'ping':
        mqtt.send_command('evt|shell|pong:arcvoice')
    elif m == 'exit':
        wake_disarm()
        mqtt.send_command('evt|shell|bye:arcvoice')
        time.sleep_ms(100)
        system.exit()


def _san(t):
    out = ''
    for ch in t:
        if ch.isalpha() or ch.isdigit() or ch in ' .:,_-()':
            out += ch
    return out[:120]


def main():
    global frame, last_tap
    while True:
        g = touch.gesture()
        if g == 'swipe_down' or g == 'long_press' or buttons.any():
            wake_disarm()
            system.exit()
        if g == 'press':
            p = touch.pos()
            if p and p[0] >= W - 48 and p[1] <= BAR_H + 8:
                wake_disarm()
                system.exit()
        if g == 'press' and state in ('idle', 'working') and time.ticks_diff(time.ticks_ms(), last_tap) > 800:
            last_tap = time.ticks_ms()
            listen()
        elif wake_on and state in ('idle', 'working') and audio.wake_detected():
            listen()
        for _ in range(8):
            m = mqtt.recv()
            if m is None:
                break
            handle(m)
        draw()
        frame += 1
        if frame % 60 == 0:
            gc.collect()
        time.sleep_ms(40)


mqtt.send_command('evt|shell|ready:arcvoice')
wake_arm()
mqtt.send_command('evt|shell|wake:' + ('armed' if wake_on else 'unavailable'))
try:
    main()
except Exception as e:
    mqtt.send_command('evt|shell|error:' + _san(repr(e)))
    raise


