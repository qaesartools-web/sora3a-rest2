package iq.sora3a.cashier;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

// جهاز الكاشير «مركز» شبكة المطعم: شاشة المطبخ/المجهز وشاشة «طلبك جاهز» وتلفون الخط يتصلون بيه (نفس desktop/lan.js createHub)
//  الأحداث للصفحة: {t:'join'|'leave'|'msg'|'ev'|'status', ...}
public final class LanHub {
    public interface Listener { void onEvent(JSONObject ev); }

    private static final class Client { String id, role, dev, name, ip; long since; LanWire w; }

    private final Listener l;
    private final int udpPort, tcpPort;
    private final String host;
    private final List<String> bcast;
    private final Map<String, Client> clients = new ConcurrentHashMap<>();
    private final Map<String, Long> seen = new LinkedHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();
    private volatile LanProto.Cfg cfg;
    private volatile ServerSocket srv;
    private volatile DatagramSocket udp;
    private volatile String err = "";
    private volatile int port;
    private volatile java.util.function.Consumer<DatagramSocket> udpHook;

    public LanHub(Listener l) { this(l, LanProto.UDP_PORT, LanProto.TCP_PORT, null, null); }
    // للتجارب: منافذ وعناوين بث خاصة
    public LanHub(Listener l, int udpPort, int tcpPort, String host, List<String> bcast) {
        this.l = l; this.udpPort = udpPort; this.tcpPort = tcpPort; this.host = host; this.bcast = bcast;
    }

    // الأندرويد: نربط البث بالواي فاي نفسه (لو البيانات هي الشبكة الافتراضية)
    public void setUdpHook(java.util.function.Consumer<DatagramSocket> h) { udpHook = h; }

    public synchronized JSONObject start(LanProto.Cfg next) {
        if (next == null || !next.valid()) { stop(); err = "بيانات ناقصة"; emitStatus(); return status(); }
        if (cfg != null && srv != null && next.sameAs(cfg)) return status();
        stop();
        cfg = next; err = "";
        try {
            ServerSocket s = new ServerSocket();
            s.setReuseAddress(true);
            s.bind(host == null ? new InetSocketAddress(tcpPort) : new InetSocketAddress(host, tcpPort));
            srv = s; port = s.getLocalPort();
            thread("lan-accept", () -> acceptLoop(s));
            DatagramSocket u = new DatagramSocket(null);
            u.setReuseAddress(true);
            u.setBroadcast(true);
            u.bind(new InetSocketAddress(udpPort));
            if (udpHook != null) try { udpHook.accept(u); } catch (Exception ignored) {}
            udp = u;
            thread("lan-udp", () -> udpLoop(u));
        } catch (Exception e) {
            String why = e instanceof java.net.BindException ? "المنفذ مستخدم ببرنامج ثاني" : String.valueOf(e.getMessage());
            stop(); err = why;
        }
        emitStatus();
        return status();
    }

    public synchronized void stop() {
        for (Client c : clients.values()) c.w.close();
        clients.clear();
        if (srv != null) { try { srv.close(); } catch (Exception ignored) {} srv = null; }
        if (udp != null) { udp.close(); udp = null; }
        cfg = null; port = 0;
    }

    public JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            JSONArray peers = new JSONArray();
            for (Client c : clients.values())
                peers.put(new JSONObject().put("id", c.id).put("role", c.role).put("dev", c.dev).put("name", c.name).put("ip", c.ip).put("since", c.since));
            LanProto.Cfg c = cfg;
            o.put("on", srv != null).put("err", err).put("rid", c == null ? "" : c.rid).put("port", port)
                .put("ips", new JSONArray(LanProto.localIps())).put("peers", peers);
        } catch (Exception ignored) {}
        return o;
    }
    private void emitStatus() { emit(status(), "status"); }
    private void emit(JSONObject ev, String t) { try { ev.put("t", t); l.onEvent(ev); } catch (Exception ignored) {} }

    private static void thread(String name, Runnable r) { Thread t = new Thread(r, name); t.setDaemon(true); t.start(); }

    private void acceptLoop(ServerSocket s) {
        while (!s.isClosed()) {
            try { Socket sock = s.accept(); onConn(sock); }
            catch (Exception e) { if (s.isClosed()) return; }
        }
    }

    private void onConn(Socket sock) {
        final LanProto.Cfg my = cfg;
        if (my == null) { try { sock.close(); } catch (Exception ignored) {} return; }
        final String sn = LanProto.nonce();
        final Client[] cur = {null};
        final LanWire w = new LanWire(sock, new LanWire.Handler() {
            @Override public void onLine(LanWire w, JSONObject m) {
                Client c = cur[0];
                if (c == null) { auth(w, m, my, sn, cur); return; }
                try { emit(new JSONObject().put("id", c.id).put("role", c.role).put("dev", c.dev).put("d", m), "msg"); } catch (Exception ignored) {}
            }
            @Override public void onClose(LanWire w) {
                Object t = w.tag; if (t instanceof ScheduledFuture) ((ScheduledFuture<?>) t).cancel(false);
                Client c = cur[0];
                if (c != null && clients.remove(c.id, c)) {
                    try { emit(new JSONObject().put("id", c.id).put("role", c.role).put("dev", c.dev), "leave"); } catch (Exception ignored) {}
                    emitStatus();
                }
            }
        });
        w.start();
        w.tag = LanWire.TIMER.schedule(() -> { if (cur[0] == null) w.close(); }, LanProto.AUTH_MS, TimeUnit.MILLISECONDS);
        try { w.send(new JSONObject().put("t", "hi").put("v", LanProto.VER).put("rid", my.rid).put("dev", my.dev).put("name", my.name).put("n", sn)); }
        catch (Exception ignored) {}
    }

    private void auth(LanWire w, JSONObject m, LanProto.Cfg my, String sn, Client[] cur) {
        String role = LanProto.str(m, "role", 20), dev = LanProto.str(m, "dev", 80), cn = LanProto.str(m, "n", 64);
        if (!"auth".equals(m.optString("t")) || !my.rid.equals(m.optString("rid")) || !LanProto.ROLES.contains(role) || dev.isEmpty() || cn.length() < 16
            || !LanProto.same(m.optString("mac"), LanProto.macClient(my.key, sn, cn, my.rid, role, dev))) { w.close(); return; }
        // نفس الجهاز رجع اتصل قبل ما ينقطع القديم: نسكّر القديم
        for (Client o : new ArrayList<>(clients.values())) if (o.dev.equals(dev) && o.role.equals(role)) o.w.close();
        Client c = new Client();
        c.id = "c" + seq.incrementAndGet(); c.role = role; c.dev = dev; c.name = LanProto.str(m, "name", 60); c.ip = w.ip(); c.since = System.currentTimeMillis(); c.w = w;
        cur[0] = c;
        clients.put(c.id, c);
        try {
            w.send(new JSONObject().put("t", "ok").put("v", LanProto.VER).put("mac", LanProto.macServer(my.key, cn, sn, my.rid, my.dev)));
            emit(new JSONObject().put("id", c.id).put("role", role).put("dev", dev).put("name", c.name).put("ip", c.ip), "join");
        } catch (Exception ignored) {}
        emitStatus();
    }

    private void udpLoop(DatagramSocket u) {
        byte[] buf = new byte[64 * 1024];
        while (!u.isClosed()) {
            try {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                u.receive(p);
                LanProto.Cfg my = cfg;
                if (my == null) continue;
                JSONObject m = LanProto.parse(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                if (m == null) continue;
                if ("find".equals(m.optString("t")) && my.rid.equals(m.optString("rid"))) {
                    byte[] r = new JSONObject().put("t", "hub").put("v", LanProto.VER).put("rid", my.rid).put("dev", my.dev).put("name", my.name).put("port", port)
                        .toString().getBytes(StandardCharsets.UTF_8);
                    u.send(new DatagramPacket(r, r.length, p.getAddress(), p.getPort()));
                    continue;
                }
                String[] e = LanProto.checkEvent(my, m, seen, System.currentTimeMillis());
                if (e != null) emit(new JSONObject().put("dev", e[0]).put("d", new JSONObject(e[1])), "ev");
            } catch (Exception e) { if (u.isClosed()) return; }
        }
    }

    // to: معرّف الجهاز، أو '*' للكل، أو 'role:kitchen' لنوع معيّن
    public void send(String to, String line) {
        String role = to != null && to.startsWith("role:") ? to.substring(5) : "";
        for (Client c : clients.values())
            if ("*".equals(to) || c.id.equals(to) || (!role.isEmpty() && c.role.equals(role))) c.w.send(line);
    }

    public void broadcast(String d) {
        final LanProto.Cfg my = cfg; final DatagramSocket u = udp;
        if (my == null || u == null) return;
        byte[] b = LanProto.signEvent(my, d).getBytes(StandardCharsets.UTF_8);
        List<InetAddress> to = new ArrayList<>();
        if (bcast != null) { for (String a : bcast) try { to.add(InetAddress.getByName(a)); } catch (Exception ignored) {} }
        else to.addAll(LanProto.broadcastAddrs());
        thread("lan-bc", () -> { for (InetAddress a : to) try { u.send(new DatagramPacket(b, b.length, a, udpPort)); } catch (Exception ignored) {} });
    }
}
