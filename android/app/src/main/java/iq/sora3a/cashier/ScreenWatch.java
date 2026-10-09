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
import android.provider.Settings;

// تطبيق الشاشة: أول ما ينفتح التلفزيون (من الستاند باي أو بعد ما يشتغل من جديد) تطلع «طلبك جاهز» وحدها.
// خدمة صغيرة بعملية منفصلة (:watch) بدون متصفح — تسمع «الشاشة اشتغلت» وتفتح التطبيق فوق واجهة التلفزيون.
public class ScreenWatch extends Service {
    private static final String CH = "screen_watch";
    private final Handler h = new Handler(Looper.getMainLooper());
    private BroadcastReceiver rx;

    // يشغّل الخدمة إذا «يفتح وحده مع التلفزيون» مفعّلة، ويطفيها إذا لا. open: افتح التطبيق هسه (بعد تشغيل الجهاز)
    static void sync(Context ctx, boolean open) {
        if (!BuildConfig.SCREEN) return;
        Intent i = new Intent(ctx, ScreenWatch.class).putExtra("open", open);
        if (!ctx.getSharedPreferences("app", 0).getBoolean("autoStart", true)) { ctx.stopService(i); return; }
        try { if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i); } catch (Exception ignored) {}
    }

    @Override public void onCreate() {
        super.onCreate();
        foreground();
        rx = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) { bringUp(new long[]{2500, 7000, 15000}); }
        };
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(rx, f, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(rx, f);
    }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        foreground();
        // بعد تشغيل الجهاز: التلفزيون يفتح واجهته على مهل ← نحاول أكثر من مرة ونطلع فوقها
        if (intent != null && intent.getBooleanExtra("open", false)) bringUp(new long[]{4000, 12000, 25000, 45000});
        return START_STICKY;
    }

    private void bringUp(long[] delays) {
        h.removeCallbacksAndMessages(null);
        for (long ms : delays) h.postDelayed(() -> { if (!appInFront()) open(); }, ms);
    }

    private void open() {
        // أندرويد 10+: فتح شاشة من الخلفية يحتاج «الظهور فوق التطبيقات» (التلفزيونات أندرويد 9 ما تحتاجه)
        if (Build.VERSION.SDK_INT >= 29 && !Settings.canDrawOverlays(this)) return;
        try { startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)); } catch (Exception ignored) {}
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
