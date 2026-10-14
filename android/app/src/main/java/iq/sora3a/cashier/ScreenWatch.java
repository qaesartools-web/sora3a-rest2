package iq.sora3a.cashier;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;

// تطبيق الشاشة: أول ما ينفتح التلفزيون (من الستاند باي أو بعد ما يشتغل من جديد) تطلع «طلبك جاهز» وحدها.
// خدمة صغيرة بعملية منفصلة (:watch) بدون متصفح — تسمع «الشاشة اشتغلت» (ومنبّه Tick إذا الإشارة ما وصلت)،
// وبعدها «تحرس» الشاشة فترة: كل ما واجهة التلفزيون أو مصدر القنوات يطلع فوقها، ترجّعها قدام.
// وإذا شي غطّى الشاشة والتلفزيون شغّال (واجهة التطبيقات، HDMI، القنوات) وهي مو المطعم اللي طلع منها بنفسه،
// ترجع وحدها بعد 10 ثواني — بعض التلفزيونات (MediaTek) «تطفي» بس الشاشة وترجع على واجهتها بدون أي إشارة.
public class ScreenWatch extends Service {
    static final long BOOT_GUARD = 180_000, HOME_GUARD = 120_000, WAKE_GUARD = 90_000;
    private static final long STEP = 2500, RETURN_AFTER = 10_000;
    private static final String CH = "screen_watch";
    private final Handler h = new Handler(Looper.getMainLooper());
    private BroadcastReceiver rx;
    private long until, lastOpenLog, coveredSince, lastAdb, lastAdbLog;
    private boolean running, armed, sawFront, noOverlayLogged;

    // من التطبيق أو تشغيل الجهاز (العملية الرئيسية): يشغّل الخدمة والمنبّه إذا «يفتح وحده مع التلفزيون» مفعّلة، ويطفيهم إذا لا.
    // boot: الجهاز هسه اشتغل ← نحرس الشاشة 3 دقايق (التلفزيون يفتح واجهته ومصدر القنوات على مهل)
    static void sync(Context ctx, boolean boot) {
        if (!BuildConfig.SCREEN) return;
        unblock(ctx);
        boolean on = ctx.getSharedPreferences("app", 0).getBoolean("autoStart", true);
        Tick.arm(ctx, on);
        BootJob.schedule(ctx, on);
        // نتذكر متى شغّلنا المنبّه (بأي تشغيل للجهاز وبأي نسخة) — إذا اختفى بعدين بدون إعادة تشغيل = التلفزيون سكّر التطبيق بالقوة
        ctx.getSharedPreferences("app", 0).edit().putBoolean("tickArmed", on).putInt("armedBoot", Tick.bootCount(ctx)).putInt("armedVer", BuildConfig.VERSION_CODE).apply();
        if (!on) { ctx.stopService(new Intent(ctx, ScreenWatch.class)); return; }
        ensure(ctx, boot ? BOOT_GUARD : 0);
    }

    // بعض «مدراء التلفزيون» يمنعون التشغيل التلقائي بإطفاء أجزاء التطبيق (استقبال التشغيل، المنبّه، المراقبة).
    //   التطبيق يكدر يرجّع أجزاءه هو — نفحصها كل مرة ونرجّعها، ونسجّل إذا لكيناها مطفية. يرجّع true إذا رجّع شي.
    static boolean unblock(Context ctx) {
        if (!BuildConfig.SCREEN) return false;
        boolean fixed = false;
        PackageManager pm = ctx.getPackageManager();
        for (Class<?> c : new Class<?>[]{BootReceiver.class, Tick.class, ScreenWatch.class, UpdateReceiver.class, ScreenListener.class, BootJob.class}) {
            try {
                ComponentName cn = new ComponentName(ctx, c);
                int st = pm.getComponentEnabledSetting(cn);
                if (st == PackageManager.COMPONENT_ENABLED_STATE_DISABLED || st == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER) {
                    pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
                    AutoLog.add(ctx, "unblocked", c.getSimpleName());
                    fixed = true;
                }
            } catch (Exception e) { AutoLog.add(ctx, "err", "unblock " + c.getSimpleName() + " " + e.getClass().getSimpleName()); }
        }
        return fixed;
    }

    // المطعم فتح شي من الشاشة نفسها (إعدادات التلفزيون، رابط، تحديث...) ← نوقف الحراسة والرجوع حتى ما نرجّعه للشاشة غصب
    static void pause(Context ctx) { if (BuildConfig.SCREEN) ensure(ctx, -1); }

    // الشاشة انغطّت وهي مو المطعم اللي طلع منها ← ترجع وحدها بعد 10 ثواني والتلفزيون شغّال (لحد ما ترجع قدام)
    static void away(Context ctx) { if (BuildConfig.SCREEN) start(ctx, new Intent(ctx, ScreenWatch.class).putExtra("away", true)); }

    // يشغّل الخدمة (أو يوصلها إذا شغّالة). guard > 0: احرس الشاشة هالمدة، guard < 0: وقّف الحراسة
    static void ensure(Context ctx, long guard) { start(ctx, new Intent(ctx, ScreenWatch.class).putExtra("guard", guard)); }

    private static void start(Context ctx, Intent i) {
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
        // «ترجع وحدها» تبقى حتى لو التلفزيون سكّر الخدمة ورجعت (الملف بس هالعملية تكتب بيه)
        armed = getSharedPreferences("watch", 0).getBoolean("armed", false);
        if (armed) loop();
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
        if (intent != null && intent.getBooleanExtra("away", false)) { setArmed(true); coveredSince = 0; loop(); }
        long g = intent == null ? 0 : intent.getLongExtra("guard", 0);
        if (g > 0) guard(g); else if (g < 0) { until = 0; setArmed(false); }
        return START_STICKY;
    }

    private void guard(long ms) {
        long u = SystemClock.elapsedRealtime() + ms;
        if (u > until) until = u;
        sawFront = false;
        loop();
    }

    private void setArmed(boolean on) {
        if (armed == on) return;
        armed = on;
        getSharedPreferences("watch", 0).edit().putBoolean("armed", on).apply();
    }

    private void loop() {
        if (running) return;
        running = true;
        h.postDelayed(step, 1500);
    }

    private final Runnable step = new Runnable() {
        @Override public void run() {
            long now = SystemClock.elapsedRealtime();
            boolean guarding = now <= until;
            if (!guarding && !armed) { running = false; return; }
            if (!Tick.isOn(ScreenWatch.this)) coveredSince = 0;          // التلفزيون مطفي: نعدّ من يرجع يشتغل
            else if (appInFront()) {
                coveredSince = 0;
                setArmed(false);
                if (guarding && !sawFront) { sawFront = true; AutoLog.add(ScreenWatch.this, "front", ""); }
            } else if (guarding) open(true);
            else if (coveredSince == 0) coveredSince = now;
            else if (now - coveredSince >= RETURN_AFTER) { coveredSince = now; AutoLog.add(ScreenWatch.this, "return", ""); open(false); }
            h.postDelayed(this, STEP);
        }
    };

    private void open(boolean log) {
        // أندرويد 10+: فتح شاشة من الخلفية يحتاج «الظهور فوق التطبيقات» (التلفزيونات أندرويد 9 ما تحتاجه)
        if (Build.VERSION.SDK_INT >= 29 && !Settings.canDrawOverlays(this)) {
            if (!noOverlayLogged) { noOverlayLogged = true; AutoLog.add(this, "no-overlay", ""); }
            return;
        }
        sawFront = false;
        try {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            adbOpen();
            // وطريقة ثانية: نقدّم مهمة التطبيق نفسها (بعض التلفزيونات تتجاهل الفتح من الخلفية)
            try { for (ActivityManager.AppTask t : ((ActivityManager) getSystemService(ACTIVITY_SERVICE)).getAppTasks()) { t.moveToFront(); break; } } catch (Exception ignored) {}
            long now = SystemClock.elapsedRealtime();
            if (log && now - lastOpenLog > 10_000) { lastOpenLog = now; AutoLog.add(this, "open", ""); }
        } catch (Exception e) { AutoLog.add(this, "err", "open " + e.getClass().getSimpleName()); }
    }

    // «الفتح مثل الريموت»: إذا المطعم فعّل وضع المطوّر ووافق، نفتحها بأمر am start — التلفزيون يعامله مثل ضغطة الريموت
    private void adbOpen() {
        if (!LocalAdb.ready(this)) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastAdb < 8000) return;
        lastAdb = now;
        final boolean log = now - lastAdbLog > 60_000;
        if (log) lastAdbLog = now;
        final Context c = getApplicationContext();
        new Thread(() -> {
            try {
                LocalAdb.shell(c, "am start -n " + c.getPackageName() + "/" + MainActivity.class.getName(), 0);
                if (log) AutoLog.add(c, "adb-open", "");
            } catch (Exception e) { if (log) AutoLog.add(c, "adb-err", e.getClass().getSimpleName()); }
        }).start();
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
