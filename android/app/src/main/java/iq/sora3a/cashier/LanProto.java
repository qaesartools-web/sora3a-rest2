package iq.sora3a.cashier;

import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

// شبكة المطعم (بنت أو بدون نت): نفس بروتوكول برنامج الحاسبة (desktop/lan.js) — أي تغيير هنا لازم ينعاد هناك
//  UDP 47800: «وين الكاشير؟» (find ← hub) + أحداث صغيرة موقّعة (ev)
//  TCP 47801: سطر JSON بكل رسالة، وأول شي مصافحة بالرمز السري للمطعم (HMAC) من الطرفين
public final class LanProto {
    private LanProto() {}

    public static final int UDP_PORT = 47800, TCP_PORT = 47801, VER = 1;
    static final long PING_MS = 15_000, IDLE_MS = 45_000, AUTH_MS = 10_000, EV_AGE = 10 * 60_000;
    static final int MAX_LINE = 16 * 1024 * 1024;
    static final List<String> ROLES = java.util.Arrays.asList("kitchen", "screen", "line", "waiter");
    private static final SecureRandom RND = new SecureRandom();

    // إعدادات المطعم على هذا الجهاز: المطعم + الرمز السري + معرّف الجهاز + اسمه
    public static final class Cfg {
        public final String rid, key, dev, name;
        public Cfg(String rid, String key, String dev, String name) {
            this.rid = cut(rid, 80); this.key = cut(key, 200); this.dev = cut(dev, 80); this.name = cut(name, 60);
        }
        public boolean valid() { return !rid.isEmpty() && key.length() >= 32 && !dev.isEmpty(); }
        public boolean sameAs(Cfg o) { return o != null && rid.equals(o.rid) && key.equals(o.key) && dev.equals(o.dev); }
        public static Cfg of(JSONObject o) {
            if (o == null) return null;
            return new Cfg(o.optString("rid", ""), o.optString("key", ""), o.optString("dev", ""), o.optString("name", ""));
        }
        public JSONObject json() {
            JSONObject o = new JSONObject();
            try { o.put("rid", rid).put("key", key).put("dev", dev).put("name", name); } catch (Exception ignored) {}
            return o;
        }
    }

    static String cut(String s, int max) { if (s == null) return ""; return s.length() > max ? s.substring(0, max) : s; }
    static String str(JSONObject o, String k, int max) { Object v = o == null ? null : o.opt(k); return v instanceof String ? cut((String) v, max) : ""; }

    public static String hmac(String key, String s) {
        try {
            Mac m = Mac.getInstance("HmacSHA256");
            m.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return hex(m.doFinal(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
        return sb.toString();
    }
    public static String nonce() { byte[] b = new byte[16]; RND.nextBytes(b); return hex(b); }
    // مقارنة بوقت ثابت (ما تكشف كم حرف صح)
    static boolean same(String a, String b) {
        if (a == null || b == null) return false;
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
    public static String macClient(String key, String sn, String cn, String rid, String role, String dev) { return hmac(key, "c|" + sn + "|" + cn + "|" + rid + "|" + role + "|" + dev); }
    public static String macServer(String key, String cn, String sn, String rid, String dev) { return hmac(key, "s|" + cn + "|" + sn + "|" + rid + "|" + dev); }
    public static String macEvent(String key, String rid, String dev, String id, long at, String d) { return hmac(key, "e|" + rid + "|" + dev + "|" + id + "|" + at + "|" + d); }

    static JSONObject parse(String s) {
        if (s == null || s.isEmpty() || s.charAt(0) != '{') return null;
        try { return new JSONObject(s); } catch (Exception e) { return null; }
    }

    // حدث موقّع بالبث: كل الأجهزة على نفس الراوتر تستلمه (d = JSON كنص)
    public static String signEvent(Cfg c, String d) {
        String id = nonce(); long at = System.currentTimeMillis();
        try {
            return new JSONObject().put("t", "ev").put("rid", c.rid).put("dev", c.dev).put("id", id).put("at", at).put("d", d)
                .put("mac", macEvent(c.key, c.rid, c.dev, id, at, d)).toString();
        } catch (Exception e) { return "{}"; }
    }
    // يرجع {dev, d} إذا الحدث صحيح وجديد، وإلا null
    public static String[] checkEvent(Cfg c, JSONObject m, Map<String, Long> seen, long now) {
        if (c == null || m == null || !"ev".equals(m.optString("t")) || !c.rid.equals(m.optString("rid"))) return null;
        String dev = str(m, "dev", 80), id = str(m, "id", 64), d = m.opt("d") instanceof String ? m.optString("d") : null;
        long at = m.optLong("at", 0);
        if (d == null || id.isEmpty() || dev.equals(c.dev)) return null;
        if (!same(m.optString("mac"), macEvent(c.key, c.rid, dev, id, at, d)) || Math.abs(now - at) > EV_AGE) return null;
        synchronized (seen) {
            if (seen.containsKey(id)) return null;
            seen.put(id, now);
            if (seen.size() > 500) { Iterator<String> it = seen.keySet().iterator(); for (int i = 0; i < 200 && it.hasNext(); i++) { it.next(); it.remove(); } }
        }
        return parse(d) == null ? null : new String[]{dev, d};
    }

    // بيانات الهاتف والـVPN مو شبكة المطعم
    static boolean skipIf(NetworkInterface ni) {
        try {
            String n = String.valueOf(ni.getName()).toLowerCase(java.util.Locale.ROOT);
            return !ni.isUp() || ni.isLoopback() || n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("pdp") || n.startsWith("v4-")
                || n.startsWith("tun") || n.startsWith("ppp") || n.startsWith("dummy");
        } catch (Exception e) { return true; }
    }

    // عناوين البث لكل شبكة بالجهاز (192.168.1.255…) + البث العام
    public static List<InetAddress> broadcastAddrs() {
        Set<InetAddress> out = new LinkedHashSet<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (skipIf(ni)) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses())
                    if (ia.getAddress() instanceof Inet4Address && ia.getBroadcast() != null) out.add(ia.getBroadcast());
            }
        } catch (Exception ignored) {}
        try { out.add(InetAddress.getByName("255.255.255.255")); } catch (Exception ignored) {}
        return new ArrayList<>(out);
    }
    // عناوين هذا الجهاز وطول الشبكة (للبحث بالشبكة إذا الراوتر يمنع البث)
    public static List<InterfaceAddress> localNets() {
        List<InterfaceAddress> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (skipIf(ni)) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses())
                    if (ia.getAddress() instanceof Inet4Address && !ia.getAddress().isLinkLocalAddress()) out.add(ia);
            }
        } catch (Exception ignored) {}
        return out;
    }
    public static List<String> localIps() {
        List<String> out = new ArrayList<>();
        for (InterfaceAddress ia : localNets()) out.add(ia.getAddress().getHostAddress());
        return out;
    }
}
