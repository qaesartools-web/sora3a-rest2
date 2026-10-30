package iq.sora3a.cashier;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

// جهاز يتصل بكاشير المطعم على نفس الراوتر (شاشة المطبخ/المجهز، شاشة «طلبك جاهز»، تلفون الخط) — نفس desktop/lan.js createClient
//  يلكى الكاشير بالبث، وبالعناوين اللي اشتغلت قبل، وإذا الراوتر يمنع البث يدوّر بكل الشبكة (192.168.1.1 → 254)
//  الأحداث للصفحة: {t:'join'|'leave'|'msg'|'status', ...}
public final class LanClient {
    public interface Listener { void onEvent(JSONObject ev); }
    // التلفون أبو الشريحة: الواي فاي بدون نت والأندرويد يحوّل للبيانات ← نربط الاتصال بالواي فاي نفسه
    public interface Net { Socket socket() throws IOException; DatagramSocket udp() throws IOException; }
    public interface Store { String load(); void save(String json); }
    public static final Net PLAIN = new Net() {
        @Override public Socket socket() { return new Socket(); }
        @Override public DatagramSocket udp() throws IOException { return new DatagramSocket(); }
    };

    private static final class Hub { String dev, name = "", ip; int port; volatile LanWire w; volatile boolean on; }

    private final String role;
    private final Listener l;
    private final Net net;
    private final int udpPort;
    private final List<String> targets;
    private final Store store;
    private final boolean sweep;
    private final Map<String, Hub> hubs = new ConcurrentHashMap<>();
    private final Set<String> trying = ConcurrentHashMap.newKeySet();
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> { Thread t = new Thread(r, "lan-client"); t.setDaemon(true); return t; });
    private volatile LanProto.Cfg cfg;
    private volatile DatagramSocket udp;
    private volatile ScheduledFuture<?> findT;
    private volatile long lastOn = System.currentTimeMillis(), lastSweep;
    private volatile int gen;

    public LanClient(String role, Listener l, Net net, Store store) { this(role, l, net, store, LanProto.UDP_PORT, null, true); }
    // للتجارب: منفذ وعناوين خاصة، وبدون البحث بكل الشبكة
    public LanClient(String role, Listener l, Net net, Store store, int udpPort, List<String> targets, boolean sweep) {
        this.role = role; this.l = l; this.net = net == null ? PLAIN : net; this.store = store; this.udpPort = udpPort; this.targets = targets; this.sweep = sweep;
    }

    public synchronized void start(LanProto.Cfg c) {
        if (c != null && c.sameAs(cfg) && udp != null) return;
        stop();
        if (c == null || !c.valid()) return;
        cfg = c;
        final int g = ++gen;
        lastOn = System.currentTimeMillis();
        loadStore();
        try {
            DatagramSocket u = net.udp();
            u.setBroadcast(true);
            udp = u;
            pool.execute(() -> udpLoop(u, g));
        } catch (Exception ignored) {}
        findT = LanWire.TIMER.schedule(() -> find(g), 0, TimeUnit.MILLISECONDS);
    }

    public synchronized void stop() {
        gen++;
        if (findT != null) { findT.cancel(false); findT = null; }
        for (Hub h : hubs.values()) { LanWire w = h.w; if (w != null) w.close(); }
        hubs.clear();
        trying.clear();
        if (udp != null) { udp.close(); udp = null; }
        cfg = null;
    }

    public boolean anyOn() { for (Hub h : hubs.values()) if (h.on) return true; return false; }

    // ينتظر لحد ما يتصل بكاشير واحد على الأقل (الخط: المكالمة لازم توصل خلال ثواني)
    public boolean awaitHub(long ms) {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) { if (anyOn()) return true; try { Thread.sleep(100); } catch (InterruptedException e) { return anyOn(); } }
        return anyOn();
    }

    public JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            JSONArray peers = new JSONArray();
            for (Hub h : hubs.values()) if (h.on) peers.put(new JSONObject().put("id", h.dev).put("name", h.name).put("ip", h.ip));
            o.put("on", cfg != null).put("rid", cfg == null ? "" : cfg.rid).put("ips", new JSONArray(LanProto.localIps())).put("peers", peers);
        } catch (Exception ignored) {}
        return o;
    }
    private void emit(JSONObject ev, String t) { try { ev.put("t", t); l.onEvent(ev); } catch (Exception ignored) {} }
    private void emitStatus() { emit(status(), "status"); }

    public void send(String to, String line) {
        for (Hub h : hubs.values()) { LanWire w = h.w; if (h.on && w != null && ("*".equals(to) || h.dev.equals(to))) w.send(line); }
    }

    // حدث موقّع بالبث (الخط: المكالمة توصل حتى لو الاتصال بالكاشير بعده ما خلص)
    public void broadcast(String d) {
        final LanProto.Cfg my = cfg; final DatagramSocket u = udp;
        if (my == null || u == null) return;
        byte[] b = LanProto.signEvent(my, d).getBytes(StandardCharsets.UTF_8);
        pool.execute(() -> { for (InetAddress a : findTargets()) try { u.send(new DatagramPacket(b, b.length, a, udpPort)); } catch (Exception ignored) {} });
    }

    private List<InetAddress> findTargets() {
        Set<InetAddress> to = new LinkedHashSet<>();
        if (targets != null) { for (String a : targets) try { to.add(InetAddress.getByName(a)); } catch (Exception ignored) {} }
        else to.addAll(LanProto.broadcastAddrs());
        for (Hub h : hubs.values()) if (h.ip != null) try { to.add(InetAddress.getByName(h.ip)); } catch (Exception ignored) {}
        return new ArrayList<>(to);
    }

    private void find(int g) {
        final LanProto.Cfg my = cfg; final DatagramSocket u = udp;
        if (my == null || g != gen) return;
        try {
            byte[] b = new JSONObject().put("t", "find").put("v", LanProto.VER).put("rid", my.rid).put("dev", my.dev).put("role", role)
                .toString().getBytes(StandardCharsets.UTF_8);
            if (u != null) for (InetAddress a : findTargets()) try { u.send(new DatagramPacket(b, b.length, a, udpPort)); } catch (Exception ignored) {}
        } catch (Exception ignored) {}
        // العناوين اللي اشتغلت قبل: نتصل مباشرة (حتى لو الراوتر يمنع البث)
        for (Hub h : hubs.values()) if (!h.on && h.port > 0) connect(h.ip, h.port, h.dev, g);
        long now = System.currentTimeMillis();
        boolean on = anyOn();
        if (on) lastOn = now;
        if (sweep && !on && now - lastOn > 20_000 && now - lastSweep > 120_000) { lastSweep = now; pool.execute(() -> sweepNet(g)); }
        synchronized (this) { if (g == gen) findT = LanWire.TIMER.schedule(() -> find(g), on ? 15_000 : 3_000, TimeUnit.MILLISECONDS); }
    }

    private void udpLoop(DatagramSocket u, int g) {
        byte[] buf = new byte[8 * 1024];
        while (!u.isClosed() && g == gen) {
            try {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                u.receive(p);
                LanProto.Cfg my = cfg;
                JSONObject m = LanProto.parse(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                if (my == null || m == null || !"hub".equals(m.optString("t")) || !my.rid.equals(m.optString("rid"))) continue;
                String dev = LanProto.str(m, "dev", 80);
                int port = m.optInt("port", 0);
                if (dev.isEmpty() || port <= 0) continue;
                Hub h = hubOf(dev);
                h.name = LanProto.str(m, "name", 60); h.ip = p.getAddress().getHostAddress(); h.port = port;
                connect(h.ip, port, dev, g);
            } catch (Exception e) { if (u.isClosed()) return; }
        }
    }

    private Hub hubOf(String dev) {
        Hub h = hubs.get(dev);
        if (h == null) { h = new Hub(); h.dev = dev; Hub o = hubs.putIfAbsent(dev, h); if (o != null) h = o; }
        return h;
    }

    // يدوّر بكل الشبكة (الراوتر يمنع البث، وأول مرة ماكو عنوان محفوظ)
    private void sweepNet(int g) {
        List<String> ips = new ArrayList<>();
        Set<String> mine = new LinkedHashSet<>(LanProto.localIps());
        for (InterfaceAddress ia : LanProto.localNets()) {
            if (!(ia.getAddress() instanceof Inet4Address) || !ia.getAddress().isSiteLocalAddress()) continue;   // شبكة داخلية بس (192.168… / 10… / 172.16…)
            byte[] a = ia.getAddress().getAddress();
            for (int i = 1; i < 255; i++) {
                String ip = (a[0] & 255) + "." + (a[1] & 255) + "." + (a[2] & 255) + "." + i;
                if (!mine.contains(ip)) ips.add(ip);
            }
        }
        ExecutorService sw = Executors.newFixedThreadPool(32, r -> { Thread t = new Thread(r, "lan-sweep"); t.setDaemon(true); return t; });
        for (String ip : ips) sw.execute(() -> {
            if (g != gen || anyOn()) return;
            try (Socket s = net.socket()) {
                s.connect(new InetSocketAddress(ip, LanProto.TCP_PORT), 400);
            } catch (Exception e) { return; }
            connect(ip, LanProto.TCP_PORT, null, g);   // المنفذ مفتوح ← نجرب المصافحة
        });
        sw.shutdown();
    }

    // expectDev: الكاشير المتوقع (null بالبحث بالشبكة: نعرفه من أول رسالة)
    private void connect(String ip, int port, String expectDev, int g) {
        if (ip == null || cfg == null || g != gen) return;
        if (expectDev != null) { Hub h = hubs.get(expectDev); if (h != null && (h.on || (h.w != null && !h.w.dead()))) return; }
        final String key = ip + ":" + port;
        if (!trying.add(key)) return;
        pool.execute(() -> {
            try { dial(ip, port, expectDev, g); }
            finally { trying.remove(key); }
        });
    }

    private void dial(String ip, int port, String expectDev, int g) {
        final LanProto.Cfg my = cfg;
        if (my == null || g != gen) return;
        Socket s;
        try { s = net.socket(); s.connect(new InetSocketAddress(ip, port), 3000); }
        catch (Exception e) { return; }
        final String cn = LanProto.nonce();
        final String[] sn = {null};
        final Hub[] hub = {null};
        final Object lock = new Object();
        LanWire w = new LanWire(s, new LanWire.Handler() {
            @Override public void onLine(LanWire w, JSONObject m) {
                Hub h = hub[0];
                if (h != null && h.on) {
                    try { emit(new JSONObject().put("id", h.dev).put("d", m), "msg"); } catch (Exception ignored) {}
                    return;
                }
                String t = m.optString("t");
                if ("hi".equals(t) && sn[0] == null) {
                    if (g != gen) { w.close(); return; }
                    String dev = LanProto.str(m, "dev", 80), n = LanProto.str(m, "n", 64);
                    if (!my.rid.equals(m.optString("rid")) || dev.isEmpty() || n.isEmpty() || (expectDev != null && !expectDev.equals(dev))) { w.close(); return; }
                    sn[0] = n;
                    Hub x = hubOf(dev);
                    synchronized (lock) {
                        if (x.on || (x.w != null && x.w != w && !x.w.dead())) { w.close(); return; }   // متصل بيه من طريق ثاني
                        x.w = w; x.ip = ip; x.port = port;
                        if (x.name.isEmpty()) x.name = LanProto.str(m, "name", 60);
                    }
                    hub[0] = x;
                    try {
                        w.send(new JSONObject().put("t", "auth").put("v", LanProto.VER).put("rid", my.rid).put("role", role).put("dev", my.dev)
                            .put("name", my.name).put("n", cn).put("mac", LanProto.macClient(my.key, n, cn, my.rid, role, my.dev)));
                    } catch (Exception e) { w.close(); }
                    return;
                }
                if ("ok".equals(t) && h != null && sn[0] != null && LanProto.same(m.optString("mac"), LanProto.macServer(my.key, cn, sn[0], my.rid, h.dev))) {
                    h.on = true; lastOn = System.currentTimeMillis();
                    saveStore();
                    try { emit(new JSONObject().put("id", h.dev).put("name", h.name).put("ip", h.ip), "join"); } catch (Exception ignored) {}
                    emitStatus();
                    return;
                }
                w.close();
            }
            @Override public void onClose(LanWire w) {
                Hub h = hub[0];
                if (h == null || h.w != w) return;
                boolean was = h.on;
                h.on = false; h.w = null;
                if (was) {
                    try { emit(new JSONObject().put("id", h.dev), "leave"); } catch (Exception ignored) {}
                    emitStatus();
                    if (g == gen) LanWire.TIMER.schedule(() -> find(g), 1000, TimeUnit.MILLISECONDS);
                }
            }
        });
        w.start();
        LanWire.TIMER.schedule(() -> { Hub h = hub[0]; if (h == null || !h.on) w.close(); }, LanProto.AUTH_MS, TimeUnit.MILLISECONDS);
    }

    // العناوين اللي اشتغلت: تنحفظ حتى بعد إعادة التشغيل نتصل مباشرة
    private void loadStore() {
        if (store == null) return;
        try {
            JSONArray a = new JSONArray(store.load());
            for (int i = 0; i < a.length() && i < 8; i++) {
                JSONObject o = a.getJSONObject(i);
                String dev = LanProto.str(o, "dev", 80), ip = LanProto.str(o, "ip", 64);
                if (dev.isEmpty() || ip.isEmpty()) continue;
                Hub h = hubOf(dev); h.ip = ip; h.port = o.optInt("port", LanProto.TCP_PORT); h.name = LanProto.str(o, "name", 60);
            }
        } catch (Exception ignored) {}
    }
    private void saveStore() {
        if (store == null) return;
        try {
            JSONArray a = new JSONArray();
            for (Hub h : hubs.values()) if (h.ip != null && h.port > 0) a.put(new JSONObject().put("dev", h.dev).put("ip", h.ip).put("port", h.port).put("name", h.name));
            store.save(a.toString());
        } catch (Exception ignored) {}
    }
}
