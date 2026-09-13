# Receipt fragment for the agent shell (runs inside agent_shell.py's
# sandbox: display/W/H/BG/FG/DIM/ACC/data/emit are injected). Shows the
# outcome of a voice-triggered x402 payment on Arc. Sent via
# "frag receipt\n<this file>" after "data <k> <v>" updates.
BIG = H >= 320
TS = 2 if BIG else 1
CS = 1 if BIG else 0
TCW = 6 * (TS + 1)
CCW = 6 * (CS + 1)
LH = 22 if BIG else 16
GN = display.color(82, 214, 138)
RD = display.color(246, 70, 82)
AM = display.color(255, 184, 76)

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

def draw(frame):
    display.clear(BG)
    ok = data.get('status', '') == 'paid'
    col = GN if ok else (AM if data.get('status') == 'declined' else RD)
    title = 'SETTLED ON ARC' if ok else ('DECLINED' if data.get('status') == 'declined' else 'FAILED')
    display.rect_filled(0, 0, W, LH + 10, col)
    display.text(14, 6, title, TS, BG)
    y = LH + 22
    for ln in wrap(data.get('ask', ''), (W - 28) // CCW)[:2]:
        display.text(14, y, ln, CS, DIM)
        y += LH - 4
    y += 6
    row(y, 'skill', data.get('skill', '-'), FG); y += LH
    row(y, 'job', data.get('job', '-'), FG); y += LH
    row(y, 'price', data.get('price', '-') + ' USDC', FG); y += LH
    row(y, 'network', data.get('network', 'Arc testnet'), FG); y += LH
    row(y, 'tx', data.get('tx', '-'), ACC); y += LH
    row(y, 'balance', data.get('balance', '-') + ' USDC', FG); y += LH
    row(y, 'today', data.get('today', '-') + ' USDC', FG); y += LH + 4
    for ln in wrap(data.get('result', ''), (W - 28) // TCW)[:4]:
        display.text(14, y, ln, TS, FG)
        y += LH
        display.text(14, H - LH, 'swipe down to close', CS, DIM)

def on_touch(x, y):
    emit('receipt:tap')
