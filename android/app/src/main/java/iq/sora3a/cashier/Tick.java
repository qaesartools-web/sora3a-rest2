package iq.sora3a.cashier;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;

// تطبيق الشاشة: منبّه كل دقيقة تقريباً (ما يصحّي الجهاز) بعملية خدمة المراقبة (:watch).
//  • يرجّع خدمة المراقبة إذا التلفزيون سكّرها.
//  • المنبّه اللي يفوت وقته والتلفزيون بالستاند باي يوصل أول ما يصحى ← فرق وقت كبير = التلفزيون رجع يشتغل
//    ← نفتح الشاشة، حتى لو التلفزيون ما بعث «الشاشة اشتغلت» أو سكّر الخدمة وهو نايم.
public class Tick extends BroadcastReceiver {
    private static final long EVERY = 60_000, GAP = 150_000;

    private static PendingIntent pi(Context ctx) {
        return PendingIntent.getBroadcast(ctx, 0, new Intent(ctx, Tick.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void arm(Context ctx, boolean on) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (on) am.setRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + EVERY, EVERY, pi(ctx));
            else am.cancel(pi(ctx));
        } catch (Exception ignored) {}
    }

    @Override public void onReceive(Context ctx, Intent intent) {
        // هذا الملف بس عملية :watch تكتب بيه
        SharedPreferences p = ctx.getSharedPreferences("watch", 0);
        long now = SystemClock.elapsedRealtime(), last = p.getLong("tick", 0);
        boolean on = isOn(ctx), wasOn = p.getBoolean("on", true);
        p.edit().putLong("tick", now).putBoolean("on", on).apply();
        long gap = last > 0 && last < now ? now - last : 0;
        boolean woke = on && (gap > GAP || !wasOn);
        if (woke) AutoLog.add(ctx, "wake", gap > GAP ? String.valueOf(gap / 60000) : "");
        ScreenWatch.ensure(ctx, woke ? ScreenWatch.WAKE_GUARD : 0);
    }

    // عدد مرات تشغيل الجهاز من جديد — حتى نفرّق «انطفى وانشغل» عن «التلفزيون سكّر التطبيق بالقوة»
    static int bootCount(Context ctx) {
        try { return Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.BOOT_COUNT); } catch (Exception e) { return -1; }
    }

    static boolean isOn(Context ctx) {
        try { return ((PowerManager) ctx.getSystemService(Context.POWER_SERVICE)).isInteractive(); } catch (Exception e) { return true; }
    }
}
