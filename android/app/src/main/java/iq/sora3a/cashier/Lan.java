package iq.sora3a.cashier;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramSocket;
import java.net.Socket;
import java.util.UUID;

// شبكة المطعم على الأندرويد (بنت أو بدون نت):
//  الكاشير «مركز» (LanHub)، وشاشة المطبخ/المجهز والشاشة وتلفون الخط يتصلون بيه (LanClient)
//  الإعدادات (المطعم + الرمز السري) تنحفظ، فالتطبيق يتصل وحده من يفتح حتى لو النت مقطوع
public final class Lan {
    private static Lan inst;
    public static synchronized Lan get(Context c) { if (inst == null) inst = new Lan(c.getApplicationContext()); return inst; }

    public static String role() { return BuildConfig.LINE ? "line" : BuildConfig.SCREEN ? "screen" : BuildConfig.KITCHEN ? "kitchen" : BuildConfig.WAITER ? "waiter" : "hub"; }
    static boolean isHub() { return "hub".equals(role()); }

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private LanHub hub;
    private LanClient client;
    private LanProto.Cfg cfg;
    private volatile WebView web;
    private volatile MainActivity act;
    private WifiManager.MulticastLock mlock;
    private boolean watching;
    private volatile Network curNet;

    private Lan(Context ctx) { this.ctx = ctx; }

    private SharedPreferences prefs() { return ctx.getSharedPreferences("lan", Context.MODE_PRIVATE); }

    // معرّف ثابت لهذا الجهاز (الكاشير يميّز كل شاشة)
    String devId() {
        String d = prefs().getString("dev", "");
        if (d.isEmpty()) { d = role() + "-" + UUID.randomUUID().toString().substring(0, 12); prefs().edit().putString("dev", d).apply(); }
        return d;
    }

    private static String defName() {
        switch (role()) { case "kitchen": return "شاشة المطبخ"; case "screen": return "شاشة طلبك جاهز"; case "line": return "خط المطعم"; case "waiter": return "الويتر"; default: return "الكاشير"; }
    }

    // من الصفحة: {rid, key, dev?, name?} — تنحفظ وتشتغل
    public synchronized JSONObject start(JSONObject o, boolean save) {
        if (o == null) return status();
        String dev = o.optString("dev", ""), name = o.optString("name", "");
        LanProto.Cfg c = new LanProto.Cfg(o.optString("rid", ""), o.optString("key", ""), dev.isEmpty() ? devId() : dev, name.isEmpty() ? defName() : name);
        if (!c.valid()) return status();
        if (save) {
            prefs().edit().putString("cfg", c.json().toString()).apply();
            if (BuildConfig.LINE) prefs().edit().putString("cfg_" + c.rid, c.json().toString()).apply();
        }
        run(c);
        return status();
    }

    // فتح التطبيق: نتصل بآخر إعدادات انحفظت (حتى بدون نت)
    public synchronized void autoStart() {
        if (cfg != null) return;
        try { String s = prefs().getString("cfg", null); if (s != null) run(LanProto.Cfg.of(new JSONObject(s))); } catch (Exception ignored) {}
    }

    private void run(LanProto.Cfg c) {
        if (c == null || !c.valid()) return;
        cfg = c;
        watchNet();
        if (isHub()) {
            if (hub == null) { hub = new LanHub(this::emit); hub.setUdpHook(this::bindWifi); }
            lock(true);
            hub.start(c);
        } else {
            if (client == null) client = new LanClient(role(), this::emit, wifiNet(), store());
            client.start(c);
        }
    }

    public synchronized void stop() {
        cfg = null;
        prefs().edit().remove("cfg").apply();
        if (hub != null) hub.stop();
        if (client != null) client.stop();
        lock(false);
    }

    public synchronized JSONObject status() {
        JSONObject s = hub != null ? hub.status() : client != null ? client.status() : new JSONObject();
        try { s.put("role", role()); if (!s.has("on")) s.put("on", false); } catch (Exception ignored) {}
        return s;
    }

    public void send(String to, String line) { LanHub h = hub; LanClient c = client; if (h != null) h.send(to, line); else if (c != null) c.send(to, line); }
    public void broadcast(String d) { LanHub h = hub; LanClient c = client; if (h != null) h.broadcast(d); else if (c != null) c.broadcast(d); }

    // ── الخط: المكالمة توصل للكاشير عن طريق الواي فاي (بنفس وقت النت) ──
    //  حدث موقّع بالبث فوراً + رسالة مباشرة لكل كاشير متصل. الكاشير يشيل المكرر (نفس المعرّف، ونفس الرقم من النت)
    //  يرجع true إذا وصلت مباشرة لكاشير واحد على الأقل
    public boolean reportCall(String rid, String line, String number) {
        try {
            String s = prefs().getString("cfg_" + rid, null);
            if (s == null) { String any = prefs().getString("cfg", null); if (any != null && rid.equals(new JSONObject(any).optString("rid"))) s = any; }
            if (s == null) return false;
            LanProto.Cfg c = LanProto.Cfg.of(new JSONObject(s));
            synchronized (this) { if (client == null || cfg == null || !c.sameAs(cfg)) run(c); }
            String d = new JSONObject().put("t", "call").put("id", UUID.randomUUID().toString()).put("line", line).put("number", number)
                .put("at", System.currentTimeMillis()).toString();
            LanClient cl = client;
            if (cl == null) return false;
            cl.broadcast(d);
            if (cl.awaitHub(6000)) { cl.send("*", d); return true; }
            cl.broadcast(d);
        } catch (Exception ignored) {}
        return false;
    }

    // ── الأحداث للصفحة (بس صفحة سرعة) ──
    void attach(WebView w, MainActivity a) { web = w; act = a; }
    void detach(WebView w) { if (web == w) { web = null; act = null; } }
    private void emit(JSONObject ev) {
        final WebView w = web; final MainActivity a = act;
        if (w == null || a == null) return;
        final String js = "window.__soraLanEv&&window.__soraLanEv(" + JSONObject.quote(ev.toString()) + ")";
        main.post(() -> { if (web == w && a.pageOriginOk()) try { w.evaluateJavascript(js, null); } catch (Exception ignored) {} });
    }

    // ── الواي فاي: الاتصال يمشي من الواي فاي حتى لو الأندرويد محوّل للبيانات (الواي فاي بدون نت) ──
    private Network wifi() {
        try {
            ConnectivityManager cm = ctx.getSystemService(ConnectivityManager.class);
            if (cm == null) return null;
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                if (nc != null && (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) return n;
            }
        } catch (Exception ignored) {}
        return null;
    }
    private void bindWifi(DatagramSocket d) { Network n = wifi(); if (n != null) try { n.bindSocket(d); } catch (Exception ignored) {} }
    private LanClient.Net wifiNet() {
        return new LanClient.Net() {
            @Override public Socket socket() throws IOException { Network n = wifi(); return n != null ? n.getSocketFactory().createSocket() : new Socket(); }
            @Override public DatagramSocket udp() throws IOException { DatagramSocket d = new DatagramSocket(); bindWifi(d); return d; }
        };
    }
    private LanClient.Store store() {
        return new LanClient.Store() {
            @Override public String load() { return prefs().getString("hubs", "[]"); }
            @Override public void save(String json) { prefs().edit().putString("hubs", json).apply(); }
        };
    }
    // الواي فاي انقطع ورجع ← نعيد التشغيل (الاتصالات القديمة مربوطة بالشبكة القديمة)
    private void watchNet() {
        if (watching) return;
        watching = true;
        try {
            ConnectivityManager cm = ctx.getSystemService(ConnectivityManager.class);
            NetworkRequest req = new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET).build();
            curNet = wifi();
            cm.registerNetworkCallback(req, new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { if (!n.equals(curNet)) { curNet = n; main.postDelayed(Lan.this::restart, 1500); } }
                @Override public void onLost(Network n) { if (n.equals(curNet)) { curNet = null; main.postDelayed(Lan.this::restart, 1500); } }
            });
        } catch (Exception ignored) {}
    }
    private synchronized void restart() {
        LanProto.Cfg c = cfg;
        if (c == null) return;
        if (hub != null) hub.stop();
        if (client != null) client.stop();
        run(c);
    }
    // بعض الأجهزة ترمي البث (UDP) لما الشاشة تطفي — الكاشير لازم يسمع «وين الكاشير؟»
    private void lock(boolean on) {
        try {
            if (on && mlock == null) {
                WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
                if (wm == null) return;
                mlock = wm.createMulticastLock("sora3a-lan");
                mlock.setReferenceCounted(false);
                mlock.acquire();
            } else if (!on && mlock != null) { mlock.release(); mlock = null; }
        } catch (Exception ignored) {}
    }
}
