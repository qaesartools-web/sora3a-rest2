package iq.sora3a.cashier;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

// إعداد خط المطعم المحفوظ بالتلفون + إرسال المكالمة لكاشير المطعم
public final class LineStore {
    private LineStore() {}

    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences("line", Context.MODE_PRIVATE); }

    public static CallLine.Config load(Context c) {
        SharedPreferences p = prefs(c);
        CallLine.Config cfg = new CallLine.Config(p.getString("token", ""), p.getString("restaurantId", ""), p.getString("line", ""),
            p.getString("label", ""), p.getBoolean("sim", true), p.getBoolean("wa", true));
        return cfg.valid() ? cfg : null;
    }

    public static void save(Context c, CallLine.Config cfg) {
        CallLine.Config old = load(c);
        SharedPreferences.Editor e = prefs(c).edit().putString("token", cfg.token).putString("restaurantId", cfg.restaurantId).putString("line", cfg.line)
            .putString("label", cfg.label).putBoolean("sim", cfg.sim).putBoolean("wa", cfg.wa);
        if (old == null || !old.token.equals(cfg.token)) e.putLong("lastAt", 0).putString("lastErr", "").putString("lastNumber", "");
        e.apply();
    }

    public static void clear(Context c) { prefs(c).edit().clear().apply(); }

    // يرسل الرقم ويرجع "" إذا وصل، أو سبب الخطأ بالعربي
    public static String send(Context ctx, CallLine.Config cfg, String number, boolean whatsapp) {
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
        prefs(c).edit().putLong("lastAt", System.currentTimeMillis()).putString("lastNumber", number.trim()).putString("lastErr", err)
            .putString("lastKind", whatsapp ? "wa" : "sim").apply();
        if (!err.isEmpty()) Log.w("Sora3aLine", err);
        return err;
    }

    // مكالمة حقيقية: يرسل بالخلفية (توصل حتى والتطبيق مسكّر)، و done تنادى لما يخلص
    public static void report(Context ctx, String number, boolean whatsapp, Runnable done) {
        final Context c = ctx.getApplicationContext();
        final CallLine.Config cfg = load(c);
        if (cfg == null || (whatsapp ? !cfg.wa : !cfg.sim) || number == null || number.trim().isEmpty()
            || !CallLine.firstRing((whatsapp ? "wa:" : "sim:") + number.trim(), System.currentTimeMillis())) {
            if (done != null) done.run();
            return;
        }
        new Thread(() -> {
            try { send(c, cfg, number, whatsapp); }
            finally { if (done != null) done.run(); }
        }).start();
    }
}
