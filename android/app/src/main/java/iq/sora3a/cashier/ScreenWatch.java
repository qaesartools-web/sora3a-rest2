package iq.sora3a.cashier;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;

// تطبيق الشاشة: أول ما ينفتح التلفزيون (من الستاند باي أو بعد ما يشتغل من جديد) تطلع «طلبك جاهز» وحدها.
// خدمة صغيرة بعملية منفصلة (:watch) بدون متصفح — تسمع «الشاشة اشتغلت» (ومنبّه Tick إذا الإشارة ما وصلت)،
// وبعدها «تحرس» الشاشة فترة: كل ما واجهة التلفزيون أو مصدر القنوات يطلع فوقها، ترجّعها قدام.
public class ScreenWatch extends Service {
    static final long BOOT_GUARD = 180_000, WAKE_GUARD = 90_000;
    private static final long STEP = 2500;
    private static final String CH = "screen_watch";
    private final Handler h = new Handler(Looper.getMainLooper());
    private BroadcastReceiver rx;
    private long until, lastOpenLog;
    private boolean guarding, sawFront, noOverlayLogged;

    // من التطبيق أو تشغيل الجهاز (العملية الرئيسية): يشغّل الخدمة والمنبّه إذا «يفتح وحده مع التلفزيون» مفعّلة، ويطفيهم إذا لا.
    // boot: الجهاز هسه اشتغل ← نحرس الشاشة 3 دقايق (التلفزيون يفتح واجهته ومصدر القنوات على مهل)
    static void sync(Context ctx, boolean boot) {
        if (!BuildConfig.SCREEN) return;
        boolean on = ctx.getSharedPreferences("app", 0).getBoolean("autoStart", true);
        Tick.arm(ctx, on);
        if (!on) { ctx.stopService(new Intent(ctx, ScreenWatch.class)); return; }
        ensure(ctx, boot ? BOOT_GUARD : 0);
    }

    // يشغّل الخدمة (أو يوصلها إذا شغّالة). guard > 0: احرس الشاشة هالمدة
    static void ensure(Context ctx, long guard) {
        Intent i = new Intent(ctx, ScreenWatch.class).putExtra("guard", guard);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        } catch (Exception e) {
            try { ctx.startService(i); } catch (Exception e2) { AutoLog.add(ctx, "err", "service " + e2.getClass().getSimpleName()); }
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        foreground();
        AutoLog.add(this, "svc", "");
        rx = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                if (Intent.ACTION_SCREEN_ON.equals(i.getAction())) AutoLog.add(c, "screen-on", "");
                guard(WAKE_GUARD);
            }
        };
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(rx, f, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(rx, f);
    }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        foreground();
        // intent فارغ = التلفزيون سكّر الخدمة والنظام رجّعها
        if (intent == null) AutoLog.add(this, "restart", "");
        long g = intent == null ? 0 : intent.getLongExtra("guard", 0);
        if (g > 0) guard(g);
        return START_STICKY;
    }

    private void guard(long ms) {
        long u = SystemClock.elapsedRealtime() + ms;
        if (u > until) until = u;
        if (guarding) return;
        guarding = true; sawFront = false;
        h.postDelayed(step, 1500);
    }

    private final Runnable step = new Runnable() {
        @Override public void run() {
            if (SystemClock.elapsedRealtime() > until) { guarding = false; return; }
            if (Tick.isOn(ScreenWatch.this)) {
                if (!appInFront()) open();
                else if (!sawFront) { sawFront = true; AutoLog.add(ScreenWatch.this, "front", ""); }
            }
            h.postDelayed(this, STEP);
        }
    };

    private void open() {
        // أندرويد 10+: فتح شاشة من الخلفية يحتاج «الظهور فوق التطبيقات» (التلفزيونات أندرويد 9 ما تحتاجه)
        if (Build.VERSION.SDK_INT >= 29 && !Settings.canDrawOverlays(this)) {
            if (!noOverlayLogged) { noOverlayLogged = true; AutoLog.add(this, "no-overlay", ""); }
            return;
        }
        sawFront = false;
        try {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            long now = SystemClock.elapsedRealtime();
            if (now - lastOpenLog > 10_000) { lastOpenLog = now; AutoLog.add(this, "open", ""); }
        } catch (Exception e) { AutoLog.add(this, "err", "open " + e.getClass().getSimpleName()); }
    }

    // الشاشة قدام؟ (عملية التطبيق الرئيسية بالواجهة) — حتى ما نعيد فتحها وهي مفتوحة
    private boolean appInFront() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            for (ActivityManager.RunningAppProcessInfo p : am.getRunningAppProcesses())
                if (getPackageName().equals(p.processName)) return p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
        } catch (Exception ignored) {}
        return false;
    }

    private void foreground() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(CH, "تشغيل الشاشة تلقائياً", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
            b = new Notification.Builder(this, CH);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MIN);
        }
        b.setSmallIcon(getApplicationInfo().icon).setContentTitle("سرعة — الشاشة").setContentText("تفتح وحدها أول ما يشتغل التلفزيون").setOngoing(true);
        try { startForeground(41, b.build()); } catch (Exception ignored) {}
    }

    @Override public void onDestroy() {
        h.removeCallbacksAndMessages(null);
        if (rx != null) try { unregisterReceiver(rx); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
