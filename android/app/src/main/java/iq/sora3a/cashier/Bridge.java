package iq.sora3a.cashier;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// الجسر بين صفحة الكاشير والتطبيق — نفس واجهة برنامج الويندوز (window.SoraDesktop)
public class Bridge {
    public static final String ORIGIN = "https://qaesartools-web.github.io";
    private final MainActivity act;
    private final WebView web;
    private final PrintEngine engine;
    private final AndroidBackend backend;
    private final Simulator sim;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    public Bridge(MainActivity act, WebView web, AndroidBackend backend, HtmlRenderer renderer, Simulator sim) {
        this.act = act; this.web = web; this.backend = backend; this.sim = sim;
        this.engine = new PrintEngine(backend, renderer,
            (printer, title, copies, widthMm, page) -> sim.add(printer, title, copies, (Bitmap) page.image),
            () -> act.getSharedPreferences("app", 0).getBoolean("testMode", false), 1);
    }

    @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }

    @JavascriptInterface
    public void call(final int id, final String method, final String argsJson) {
        if (!act.pageOriginOk()) return; // بس صفحة الكاشير
        pool.execute(() -> {
            Object res;
            try { res = handle(method, new JSONArray(argsJson == null ? "[]" : argsJson)); }
            catch (Exception e) { res = errorJson(e.getMessage()); }
            final String json = String.valueOf(res);
            web.post(() -> web.evaluateJavascript("window.__soraCb&&window.__soraCb(" + id + "," + JSONObject.quote(json) + ")", null));
        });
    }

    // كل تطبيق يشوف بس دواله: الخط ما يطبع، والكاشير ما يربط خط
    private static final java.util.Set<String> LINE_METHODS = new java.util.HashSet<>(java.util.Arrays.asList(
        "getCallLine", "setCallLine", "addCallLine", "removeCallLine", "clearCallLine", "testCall", "openPerm"));

    private Object handle(String m, JSONArray a) throws Exception {
        if (BuildConfig.LINE != LINE_METHODS.contains(m)) return errorJson("unknown");
        switch (m) {
            case "printers": {
                act.ensureBluetoothPermission();
                JSONArray out = new JSONArray();
                for (PrintEngine.Printer p : engine.printers())
                    out.put(new JSONObject().put("name", p.name).put("displayName", p.name).put("isDefault", p.isDefault).put("ok", p.ok).put("statusText", p.statusText).put("kind", p.kind));
                return out;
            }
            case "print": {
                String html = a.optString(0, "");
                JSONObject o = a.optJSONObject(1); if (o == null) o = new JSONObject();
                if (html.isEmpty() || html.length() > 3_000_000) return errorJson("طلب مرفوض");
                String fb = o.isNull("fallback") || !o.has("fallback") ? null : o.optString("fallback", "");
                return result(engine.print(html, o.optString("printer", ""), o.optInt("widthMm", 80), o.optInt("copies", 1), o.optString("title", ""), fb));
            }
            case "jobs": {
                JSONArray out = new JSONArray();
                for (PrintEngine.Job j : engine.jobs())
                    out.put(new JSONObject().put("id", j.id).put("at", j.at).put("title", j.title).put("printer", j.printer).put("copies", j.copies)
                        .put("ok", j.ok == null ? JSONObject.NULL : j.ok).put("error", j.error).put("fallback", j.fallback).put("canReprint", true));
                return out;
            }
            case "reprint": return result(engine.reprint(a.optInt(0)));
            case "getTestMode": return act.getSharedPreferences("app", 0).getBoolean("testMode", false);
            case "setTestMode": {
                boolean on = a.optBoolean(0);
                act.getSharedPreferences("app", 0).edit().putBoolean("testMode", on).apply();
                if (on) sim.show();
                return on;
            }
            case "openSimulator": sim.show(); return true;
            case "addNetworkPrinter": {
                String label = backend.addLan(a.optString(0, ""), a.optString(1, ""), a.optInt(2, 9100));
                return new JSONObject().put("ok", true).put("name", label);
            }
            case "removePrinter": backend.removeLan(a.optString(0, "")); return new JSONObject().put("ok", true);
            // ── الكاشير يفتح وحده مع تشغيل الجهاز ──
            case "getAutoStart": return act.autoStartOn();
            case "setAutoStart": return act.setAutoStart(a.optBoolean(0));
            // ── خط المطعم (بدل MacroDroid) ──
            case "getCallLine": return lineStatus();
            case "setCallLine": {
                JSONObject o = a.optJSONObject(0); if (o == null) o = new JSONObject();
                CallLine.Config c = new CallLine.Config(o.optString("token", ""), o.optString("restaurantId", ""), o.optString("line", ""),
                    o.optString("label", ""), o.optBoolean("sim", true), o.optBoolean("wa", true));
                if (!c.valid()) return errorJson("بيانات الخط ناقصة");
                LineStore.save(act, c);
                if (c.sim && act.hasSim() && !act.phoneOk()) act.openPerm("phone");
                return lineStatus();
            }
            // رقم (خط) بمصادره على هذا التلفون: {token, restaurantId, line, label, sources:[{kind:'sim',slot,subId}|{kind:'wa',pkg}]}
            case "addCallLine": {
                JSONObject o = a.optJSONObject(0); if (o == null) o = new JSONObject();
                JSONArray src = o.optJSONArray("sources"); if (src == null) src = new JSONArray();
                String token = o.optString("token", "");
                List<CallLine.Config> list = new ArrayList<>();
                boolean anySim = false;
                for (int i = 0; i < src.length(); i++) {
                    JSONObject s = src.optJSONObject(i); if (s == null) continue;
                    boolean isSim = "sim".equals(s.optString("kind"));
                    anySim |= isSim;
                    list.add(new CallLine.Config(token, o.optString("restaurantId", ""), o.optString("line", ""), o.optString("label", ""),
                        isSim, !isSim, isSim ? s.optInt("slot", -1) : -1, isSim ? s.optInt("subId", -1) : -1, isSim ? "" : s.optString("pkg", "")));
                }
                if (list.isEmpty() || !list.get(0).valid()) return errorJson("بيانات الخط ناقصة");
                LineStore.put(act, token, list);
                if (anySim && act.hasSim() && !act.phoneOk()) act.openPerm("phone");
                return lineStatus();
            }
            case "removeCallLine": LineStore.remove(act, a.optString(0, "")); return lineStatus();
            case "clearCallLine": LineStore.clear(act); return lineStatus();
            case "testCall": {
                String token = a.optString(0, "");
                CallLine.Config c = null;
                for (CallLine.Config x : LineStore.loadAll(act)) if (c == null && (token.isEmpty() || x.token.equals(token))) c = x;
                if (c == null) return errorJson("التلفون مو مربوط");
                String err = LineStore.send(act, c, "07700000000", !c.sim && c.wa);
                return err.isEmpty() ? new JSONObject().put("ok", true) : errorJson(err);
            }
            case "openPerm": act.openPerm(a.optString(0, "app")); return true;
            default: return errorJson("unknown");
        }
    }

    private JSONObject lineStatus() throws Exception {
        List<CallLine.Config> all = LineStore.loadAll(act);
        CallLine.Config c = all.isEmpty() ? null : all.get(0);
        JSONObject perms = new JSONObject().put("phone", act.phoneOk()).put("notif", act.notifOk()).put("battery", act.batteryOk())
            .put("overlay", act.overlayOk()).put("sim", act.hasSim());
        JSONObject o = new JSONObject().put("linked", c != null).put("perms", perms).put("android", android.os.Build.VERSION.SDK_INT)
            .put("maker", String.valueOf(android.os.Build.MANUFACTURER).toLowerCase());
        // كل الأرقام (كل مصدر سطر) + الشرائح والواتساب الموجودة بالتلفون
        JSONArray entries = new JSONArray();
        for (CallLine.Config x : all) {
            JSONObject l = LineStore.last(act, x.token);
            entries.put(new JSONObject().put("token", x.token).put("restaurantId", x.restaurantId).put("line", x.line).put("label", x.label)
                .put("kind", x.sim ? "sim" : "wa").put("sim", x.sim).put("wa", x.wa).put("slot", x.slot).put("subId", x.subId).put("pkg", x.pkg)
                .put("lastAt", l.optLong("at", 0)).put("lastNumber", l.optString("number", "")).put("lastErr", l.optString("err", ""))
                .put("lastKind", l.optString("kind", "")).put("lastSlot", l.optInt("slot", -1)));
        }
        o.put("entries", entries).put("sims", sims()).put("waApps", new JSONObject()
            .put("com.whatsapp", installed("com.whatsapp")).put("com.whatsapp.w4b", installed("com.whatsapp.w4b")));
        // الحقول القديمة (أول رقم) حتى الصفحة القديمة تشتغل
        if (c != null) {
            JSONObject l = LineStore.last(act, c.token);
            boolean sim = false, wa = false;
            for (CallLine.Config x : all) if (x.token.equals(c.token)) { sim |= x.sim; wa |= x.wa; }
            o.put("token", c.token).put("restaurantId", c.restaurantId).put("line", c.line).put("label", c.label).put("sim", sim).put("wa", wa)
                .put("lastAt", l.optLong("at", 0)).put("lastNumber", l.optString("number", "")).put("lastErr", l.optString("err", ""))
                .put("lastKind", l.optString("kind", ""));
        }
        return o;
    }

    // الشرائح بالتلفون (تحتاج إذن الهاتف): رقم الخانة + اسم الشبكة
    private JSONArray sims() {
        JSONArray out = new JSONArray();
        if (act.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return out;
        try {
            SubscriptionManager sm = act.getSystemService(SubscriptionManager.class);
            List<SubscriptionInfo> l = sm == null ? null : sm.getActiveSubscriptionInfoList();
            if (l != null) for (SubscriptionInfo i : l) {
                CharSequence name = i.getDisplayName() != null ? i.getDisplayName() : i.getCarrierName();
                out.put(new JSONObject().put("slot", i.getSimSlotIndex()).put("subId", i.getSubscriptionId()).put("name", name == null ? "" : name.toString()));
            }
        } catch (Exception ignored) {}   // بدون إذن الهاتف
        return out;
    }

    private boolean installed(String pkg) {
        try { act.getPackageManager().getPackageInfo(pkg, 0); return true; } catch (PackageManager.NameNotFoundException e) { return false; }
    }

    private static JSONObject result(PrintEngine.Result r) throws Exception {
        return new JSONObject().put("ok", r.ok).put("fallback", r.fallback).put("error", r.error).put("printer", r.printer).put("id", r.id);
    }
    private static JSONObject errorJson(String msg) {
        try { return new JSONObject().put("ok", false).put("error", msg == null ? "خطأ" : msg); } catch (Exception e) { return new JSONObject(); }
    }

    // يتحقن ببداية الصفحة: نفس واجهة برنامج الويندوز حتى الكاشير يستخدمها بدون أي تغيير
    private static final String HEAD = "(function(){if(window.SoraDesktop||!window.SoraPOS)return;var seq=0,pend={};"
        + "window.__soraCb=function(id,j){var p=pend[id];if(!p)return;delete pend[id];var v=null;try{v=JSON.parse(j)}catch(e){}p(v)};"
        + "function call(m,a){return new Promise(function(res){var id=++seq;pend[id]=res;SoraPOS.call(id,m,JSON.stringify(a||[]))})}"
        + "window.SoraDesktop={version:SoraPOS.version(),platform:'android',";
    private static final String CASHIER = "canAutoStart:true,canAddNetwork:true,"
        + "printers:function(){return call('printers')},print:function(h,o){return call('print',[String(h||''),o||{}])},"
        + "jobs:function(){return call('jobs')},reprint:function(id){return call('reprint',[Number(id)])},"
        + "getTestMode:function(){return call('getTestMode')},setTestMode:function(on){return call('setTestMode',[!!on])},"
        + "openSimulator:function(){return call('openSimulator')},getAutoStart:function(){return call('getAutoStart')},"
        + "setAutoStart:function(on){return call('setAutoStart',[!!on])},onUpdate:function(){},"
        + "addNetworkPrinter:function(n,ip,port){return call('addNetworkPrinter',[n||'',ip||'',Number(port)||9100])},"
        + "removePrinter:function(n){return call('removePrinter',[n])}};})();";
    private static final String LINE = "canCallLine:true,"
        + "getCallLine:function(){return call('getCallLine')},setCallLine:function(c){return call('setCallLine',[c||{}])},"
        + "canMultiLine:true,addCallLine:function(c){return call('addCallLine',[c||{}])},removeCallLine:function(t){return call('removeCallLine',[String(t||'')])},"
        + "clearCallLine:function(){return call('clearCallLine')},testCall:function(t){return call('testCall',[String(t||'')])},"
        + "openPerm:function(k){return call('openPerm',[String(k||'app')])}};})();";
    public static final String SHIM = HEAD + (BuildConfig.LINE ? LINE : CASHIER);
}
