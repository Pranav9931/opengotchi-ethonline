# arcvoice — the on-device half of "OpenGotchi Jobs on Arc".
# Tap the pet, speak, and the pet agent on your LAN commissions an ERC-8183
# job on Arc. Audio goes to the agent over plain HTTP (no hosted voice API):
#   POST {AGENT}/voice/stt   raw PCM16 16 kHz mono  -> {"text": ...}
#   GET  {AGENT}/voice/tts?t= URL-encoded text       -> raw PCM16 16 kHz (streamed)
# Progress and results arrive as agent-topic directives via mqtt.recv():
#   data <key> <value>   receipt field update (status/step/skill/price/job/tx/balance/today/result)
#   speak <text>         fetch TTS from the agent and play it
#   note <text>          one-line toast
# Deployed over MQTT by `bun run deploy-app`; AGENT is substituted at deploy time.
import display, touch, buttons, time, gc, system, mqtt, audio, http

AGENT = "__AGENT_URL__"
REC_MS = 4500
W, H = display.WIDTH, display.HEIGHT
BIG = H >= 320
TS = 2 if BIG else 1
CS = 1 if BIG else 0
TCW = 6 * (TS + 1)
CCW = 6 * (CS + 1)
LH = 22 if BIG else 16
BG = display.color(0, 0, 0)
FG = display.color(238, 240, 246)
DIM = display.color(148, 154, 172)
ACC = display.color(86, 196, 222)
GN = display.color(82, 214, 138)
AM = display.color(255, 184, 76)
RD = display.color(246, 70, 82)

data = {}
state = 'idle'        # idle | listen | think | working
toast = ''
toast_until = 0
frame = 0
heard = ''
err = ''


def wrap(t, n):
    out = []
    for w in t.split():
        if out and len(out[-1]) + 1 + len(w) <= n:
            out[-1] += ' ' + w
        else:
            out.append(w[:n])
    return out


def row(y, k, v, col):
    display.text(14, y, k, CS, DIM)
    display.text(14 + 9 * CCW, y, v[:22], CS, col)


def header(title, col):
    display.rect_filled(0, 0, W, LH + 10, col)
    display.text(14, 6, title, TS, BG)


def draw():
    display.clear(BG)
    st = data.get('status', '')
    if state == 'listen':
        header('LISTENING', ACC)
        display.text(14, LH + 24, 'speak now', TS, FG)
        lvl = (frame * 7) % (W - 28)
        display.rect_filled(14, LH + 60, lvl, 6, ACC)
    elif state == 'think':
        header('TRANSCRIBING', AM)
        display.text(14, LH + 24, 'sending audio to agent' + '.' * (1 + (frame // 10) % 3), CS, DIM)
    elif st == 'working':
        header('WORKING ON ARC', ACC)
        y = LH + 22
        for ln in wrap(heard or data.get('ask', ''), (W - 28) // CCW)[:2]:
            display.text(14, y, ln, CS, DIM); y += LH - 4
        y += 6
        row(y, 'skill', data.get('skill', '-'), FG); y += LH
        row(y, 'price', data.get('price', '-') + ' USDC', FG); y += LH
        row(y, 'job', data.get('job', '-'), FG); y += LH
        row(y, 'tx', data.get('tx', '-'), ACC); y += LH
        row(y, 'step', data.get('step', '') + '.' * (1 + (frame // 10) % 3), ACC)
    elif st in ('paid', 'declined', 'failed'):
        col = GN if st == 'paid' else (AM if st == 'declined' else RD)
        header('SETTLED ON ARC' if st == 'paid' else ('DECLINED' if st == 'declined' else 'FAILED'), col)
        y = LH + 22
        for ln in wrap(data.get('ask', ''), (W - 28) // CCW)[:2]:
            display.text(14, y, ln, CS, DIM); y += LH - 4
        y += 6
        row(y, 'skill', data.get('skill', '-'), FG); y += LH
        row(y, 'job', data.get('job', '-'), FG); y += LH
        row(y, 'price', data.get('price', '-') + ' USDC', FG); y += LH
        row(y, 'network', 'Arc testnet', FG); y += LH
        row(y, 'tx', data.get('tx', '-'), ACC); y += LH
        row(y, 'balance', data.get('balance', '-') + ' USDC', FG); y += LH
        row(y, 'today', data.get('today', '-') + ' USDC', FG); y += LH + 4
        for ln in wrap(data.get('result', ''), (W - 28) // TCW)[:4]:
            display.text(14, y, ln, TS, FG); y += LH
        display.text(14, H - LH, 'tap to talk again', CS, DIM)
    else:
        header('GOTCHI JOBS ON ARC', ACC)
        y = LH + 30
        display.text(14, y, 'tap me and ask for', TS, FG); y += LH
        for ln in ('weather in a city', 'a crypto price', 'the top headline', 'a snack, a fortune'):
            display.text(24, y, ln, CS, DIM); y += LH - 4
        if heard:
            y += 8
            display.text(14, y, 'heard: ' + heard[:40], CS, DIM)
        if err:
            display.text(14, H - 2 * LH, err[:44], CS, RD)
        display.text(14, H - LH, 'swipe down to exit', CS, DIM)
    if toast and frame < toast_until:
        bh = 14 + 17
        display.rect_filled(0, H - bh, W, bh, display.color(16, 20, 34))
        display.rect_filled(0, H - bh, W, 2, ACC)
        display.text(12, H - bh + 7, toast[:44], CS, FG)
    display.flush()


def say_local(text):
    """Stream 16 kHz PCM from the agent straight into the speaker."""
    url = AGENT + '/voice/tts?t=' + urlq(text)
    try:
        audio.volume(85)
        st = http.stream(url, lambda chunk: audio.play(chunk, 16000) or True, None, 60000)
        if st != 200:
            set_toast('tts http %d' % st)
    except Exception as e:
        set_toast('tts: ' + repr(e)[:30])


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


def set_toast(t, frames=90):
    global toast, toast_until
    toast = t
    toast_until = frame + frames


def listen():
    global state, heard, err
    state = 'listen'
    err = ''
    draw()
    try:
        audio.tone(1200, 60, 60)
    except Exception:
        pass
    pcm = audio.record(REC_MS, 16000)
    state = 'think'
    draw()
    if not pcm:
        err = 'mic returned nothing'
        state = 'idle'
        return
    try:
        code, body = http.request('POST', AGENT + '/voice/stt', {'Content-Type': 'application/octet-stream'}, pcm, 60000)
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
        else:
            err = 'heard nothing, try again'
            state = 'idle'
    else:
        err = 'agent http %d' % code
        state = 'idle'


def handle(m):
    global state
    if m.startswith('data '):
        p = m.split(' ', 2)
        if len(p) == 3:
            data[p[1]] = p[2]
            if p[1] == 'status' and p[2] in ('paid', 'declined', 'failed'):
                state = 'idle'
    elif m.startswith('speak '):
        draw()
        say_local(m[6:])
    elif m.startswith('note '):
        set_toast(m[5:])
    elif m == 'ping':
        mqtt.send_command('evt|shell|pong:arcvoice')


mqtt.send_command('evt|shell|ready:arcvoice')
while True:
    g = touch.gesture()
    if g == 'swipe_down' or g == 'long_press' or buttons.pressed(1):
        system.exit()
    if g == 'press' and state in ('idle', 'working'):
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
    time.sleep_ms(50)
