package iq.sora3a.cashier;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

// اتصال TCP بشبكة المطعم: سطر JSON بكل رسالة، نبضة كل 15 ثانية، وإذا سكت 45 ثانية ينسكّر (مثل desktop/lan.js)
final class LanWire {
    interface Handler { void onLine(LanWire w, JSONObject m); void onClose(LanWire w); }

    static final ScheduledExecutorService TIMER = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "lan-timer"); t.setDaemon(true); return t; });

    private final Socket sock;
    private final Handler h;
    private final AtomicBoolean dead = new AtomicBoolean(false);
    private volatile long lastRx = System.currentTimeMillis();
    private OutputStream out;
    private ScheduledFuture<?> pinger;
    Object tag;   // للمالك (المركز أو الجهاز)

    LanWire(Socket sock, Handler h) { this.sock = sock; this.h = h; }

    void start() {
        try { sock.setTcpNoDelay(true); out = sock.getOutputStream(); }
        catch (Exception e) { close(); return; }
        pinger = TIMER.scheduleAtFixedRate(() -> {
            if (System.currentTimeMillis() - lastRx > LanProto.IDLE_MS) { close(); return; }
            send("{\"t\":\"ping\"}");
        }, LanProto.PING_MS, LanProto.PING_MS, TimeUnit.MILLISECONDS);
        Thread t = new Thread(this::readLoop, "lan-wire");
        t.setDaemon(true);
        t.start();
    }

    private void readLoop() {
        ByteArrayOutputStream line = new ByteArrayOutputStream(1024);
        byte[] buf = new byte[16 * 1024];
        try {
            InputStream in = sock.getInputStream();
            int n;
            while (!dead.get() && (n = in.read(buf)) > 0) {
                lastRx = System.currentTimeMillis();
                int from = 0;
                for (int i = 0; i < n; i++) {
                    if (buf[i] != '\n') continue;
                    line.write(buf, from, i - from);
                    from = i + 1;
                    String s = new String(line.toByteArray(), StandardCharsets.UTF_8);
                    line.reset();
                    handle(s);
                    if (dead.get()) return;
                }
                line.write(buf, from, n - from);
                if (line.size() > LanProto.MAX_LINE) break;
            }
        } catch (Exception ignored) {
        } finally { close(); }
    }

    private void handle(String s) {
        JSONObject m = LanProto.parse(s);
        if (m == null) return;
        String t = m.optString("t");
        if ("ping".equals(t)) { send("{\"t\":\"pong\"}"); return; }
        if ("pong".equals(t)) return;
        try { h.onLine(this, m); } catch (Exception ignored) {}
    }

    boolean send(String line) {
        if (dead.get() || out == null) return false;
        byte[] b = (line + "\n").getBytes(StandardCharsets.UTF_8);
        try { synchronized (this) { out.write(b); out.flush(); } return true; }
        catch (Exception e) { close(); return false; }
    }
    boolean send(JSONObject o) { return send(o.toString()); }

    boolean dead() { return dead.get(); }
    String ip() { try { return sock.getInetAddress().getHostAddress(); } catch (Exception e) { return ""; } }

    void close() {
        if (!dead.compareAndSet(false, true)) return;
        if (pinger != null) pinger.cancel(false);
        try { sock.close(); } catch (Exception ignored) {}
        try { h.onClose(this); } catch (Exception ignored) {}
    }
}
