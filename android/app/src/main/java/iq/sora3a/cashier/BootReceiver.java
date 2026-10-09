package iq.sora3a.cashier;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

// تشغيل الجهاز ← يفتح الكاشير وحده (إذا الكاشير فعّلها من الإعدادات)
// تطبيق الشاشة: يشغّل ScreenWatch، وهي تفتح الشاشة فوق واجهة التلفزيون (وبعد كل ستاند باي)
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (BuildConfig.SCREEN && Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) { ScreenWatch.sync(ctx, false); return; }
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !"android.intent.action.QUICKBOOT_POWERON".equals(a) && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(a)) return;
        if (BuildConfig.SCREEN) { ScreenWatch.sync(ctx, true); return; }
        if (!ctx.getSharedPreferences("app", 0).getBoolean("autoStart", true)) return;
        // أندرويد 10+: فتح شاشة من الخلفية يحتاج إذن «الظهور فوق التطبيقات»
        if (Build.VERSION.SDK_INT >= 29 && !Settings.canDrawOverlays(ctx)) return;
        try { ctx.startActivity(new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
    }
}
