package iq.sora3a.cashier;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

// الأرقام المربوطة على هذا التلفون (كل رقم = خط بالمطعم) + إرسال المكالمة لكاشير المطعم
//  التلفون يكدر يحمل أكثر من رقم: شريحتين، واتساب، واتساب أعمال — كل مصدر إله رقمه وخطه
public final class LineStore {
    private LineStore() {}

    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences("line", Context.MODE_PRIVATE); }

    private static JSONObject toJson(CallLine.Config c) throws Exception {
        return new JSONObject().put("token", c.token).put("restaurantId", c.restaurantId).put("line", c.line).put("label", c.label)
            .put("sim", c.sim).put("wa", c.wa).put("slot", c.slot).put("subId", c.subId).put("pkg", c.pkg);
    }
    private static CallLine.Config fromJson(JSONObject o) {
        return new CallLine.Config(o.optString("token", ""), o.optString("restaurantId", ""), o.optString("line", ""), o.optString("label", ""),
            o.optBoolean("sim", false), o.optBoolean("wa", false), o.optInt("slot", -1), o.optInt("subId", -1), o.optString("pkg", ""));
    }

    // كل الأرقام. النسخة القديمة (رقم واحد بمفاتيح مفردة) تتحول وحدها لقائمة
    public static synchronized List<CallLine.Config> loadAll(Context c) {
        SharedPreferences p = prefs(c);
        List<CallLine.Config> out = new ArrayList<>();
        String raw = p.getString("entries", null);
        if (raw == null) {
            CallLine.Config old = new CallLine.Config(p.getString("token", ""), p.getString("restaurantId", ""), p.getString("line", ""),
                p.getString("label", ""), p.getBoolean("sim", true), p.getBoolean("wa", true));
            if (old.valid()) {
                out.add(old); saveAll(c, out);
                try {   // آخر مكالمة بالنسخة القديمة
                    JSONObject l = new JSONObject().put("at", p.getLong("lastAt", 0)).put("number", p.getString("lastNumber", ""))
                        .put("err", p.getString("lastErr", "")).put("kind", p.getString("lastKind", "")).put("slot", -1);
                    p.edit().putString("last_" + old.token, l.toString()).apply();
                } catch (Exception ignored) {}
                p.edit().remove("token").remove("restaurantId").remove("line").remove("label").remove("sim").remove("wa")
                    .remove("lastAt").remove("lastNumber").remove("lastErr").remove("lastKind").apply();
            }
            return out;
        }
        try {
            JSONArray a = new JSONArray(raw);
            for (int i = 0; i < a.length(); i++) { CallLine.Config x = fromJson(a.getJSONObject(i)); if (x.valid()) out.add(x); }
        } catch (Exception e) { Log.w("Sora3aLine", "entries", e); }
        return out;
    }

    private static void saveAll(Context c, List<CallLine.Config> list) {
        JSONArray a = new JSONArray();
        try { for (CallLine.Config x : list) a.put(toJson(x)); } catch (Exception ignored) {}
        prefs(c).edit().putString("entries", a.toString()).apply();
    }

    // أول رقم (للتوافق ويا الصفحة القديمة)
    public static CallLine.Config load(Context c) { List<CallLine.Config> l = loadAll(c); return l.isEmpty() ? null : l.get(0); }

    // الصفحة القديمة: رقم واحد بس (يمسح الباقي)
    public static synchronized void save(Context c, CallLine.Config cfg) {
        List<CallLine.Config> l = new ArrayList<>(); l.add(cfg);
        saveAll(c, l);
    }

    // يربط رقم بمصادره (entries بنفس التوكن). أي رقم ثاني على نفس المصدر ينشال (المصدر إله رقم واحد)
    public static synchronized void put(Context c, String token, List<CallLine.Config> sources) {
        List<CallLine.Config> keep = new ArrayList<>();
        for (CallLine.Config x : loadAll(c)) {
            if (x.token.equals(token)) continue;
            boolean clash = false;
            for (CallLine.Config s : sources) clash |= s.sameSource(x);
            if (!clash) keep.add(x);
        }
        keep.addAll(sources);
        saveAll(c, keep);
    }

    public static synchronized void remove(Context c, String token) {
        List<CallLine.Config> keep = new ArrayList<>();
        for (CallLine.Config x : loadAll(c)) if (!x.token.equals(token)) keep.add(x);
        saveAll(c, keep);
        prefs(c).edit().remove("last_" + token).apply();
    }

    public static void clear(Context c) { prefs(c).edit().clear().apply(); }

    // آخر مكالمة لكل رقم: {at, number, err, kind, slot}
    public static JSONObject last(Context c, String token) {
        try { return new JSONObject(prefs(c).getString("last_" + token, "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    // يرسل الرقم ويرجع "" إذا وصل، أو سبب الخطأ بالعربي
    public static String send(Context ctx, CallLine.Config cfg, String number, boolean whatsapp) { return send(ctx, cfg, number, whatsapp, -1); }
    public static String send(Context ctx, CallLine.Config cfg, String number, boolean whatsapp, int slot) {
        final Context c = ctx.getApplicationContext();
        String err = "";
        for (int i = 0; i < 3; i++) {
            try {
                int code = CallLine.post(CallLine.body(cfg, number, whatsapp));
                if (code >= 200 && code < 300) { err = ""; break; }
                err = code == 403 ? "الخط موقوف أو الخدمة مطفية من الإدارة" : "خطأ " + code;
                if (code == 403) break;
            } catch (Exception e) { err = "ماكو إنترنت"; }
            if (i < 2) try { Thread.sleep(2000L * (i + 1)); } catch (InterruptedException ignored) {}
        }
        try {
            JSONObject l = new JSONObject().put("at", System.currentTimeMillis()).put("number", number.trim()).put("err", err)
                .put("kind", whatsapp ? "wa" : "sim").put("slot", slot);
            prefs(c).edit().putString("last_" + cfg.token, l.toString()).apply();
        } catch (Exception ignored) {}
        if (!err.isEmpty()) Log.w("Sora3aLine", err);
        return err;
    }

    // مكالمة شريحة حقيقية: subId/slot = أي شريحة رنّت (-1 إذا الجهاز ما يكول)
    public static void reportSim(Context ctx, String number, int subId, int slot, Runnable done) {
        final Context c = ctx.getApplicationContext();
        report(c, CallLine.pickSim(loadAll(c), subId, slot), number, false, "sim:", slot, done);
    }

    // مكالمة واتساب حقيقية من تطبيق pkg
    public static void reportWa(Context ctx, String number, String pkg) {
        final Context c = ctx.getApplicationContext();
        report(c, CallLine.pickWa(loadAll(c), pkg), number, true, "wa:" + pkg + ":", -1, null);
    }

    // يرسل بالخلفية (توصل حتى والتطبيق مسكّر)، و done تنادى لما يخلص
    private static void report(Context c, CallLine.Config cfg, String number, boolean whatsapp, String key, int slot, Runnable done) {
        if (cfg == null || number == null || number.trim().isEmpty() || !CallLine.firstRing(key + number.trim(), System.currentTimeMillis())) {
            if (done != null) done.run();
            return;
        }
        new Thread(() -> {
            try { send(c, cfg, number, whatsapp, slot); }
            finally { if (done != null) done.run(); }
        }).start();
    }
}
