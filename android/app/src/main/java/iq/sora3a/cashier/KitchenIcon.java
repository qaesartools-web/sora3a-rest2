package iq.sora3a.cashier;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.webkit.JavascriptInterface;

// تطبيق «سرعة - المطبخ»: الأيقونة واسمها بالشاشة الرئيسية حسب الشاشة اللي اختارها الجهاز
//  المطبخ (الأقسام) = فيروزي «سرعة - المطبخ»، المجهز = بنفسجي «سرعة - المجهز» (activity-alias بـ src/kitchen/AndroidManifest.xml)
public class KitchenIcon {
    private final MainActivity act;

    KitchenIcon(MainActivity act) { this.act = act; }

    static String aliasFor(String mode) { return "prep".equals(mode) ? "PrepLauncher" : "KitchenLauncher"; }

    @JavascriptInterface public void mode(String mode) {
        if (!BuildConfig.KITCHEN || !act.pageOriginOk()) return;
        String on = aliasFor(mode), off = on.equals("PrepLauncher") ? "KitchenLauncher" : "PrepLauncher";
        try {
            PackageManager pm = act.getPackageManager();
            String pkg = MainActivity.class.getPackage().getName() + ".";
            ComponentName a = new ComponentName(act, pkg + on), b = new ComponentName(act, pkg + off);
            // بس لما تتغير (التبديل يخلي الشاشة الرئيسية تحدّث الأيقونة)
            if (enabled(pm, a, on) && !enabled(pm, b, off)) return;
            pm.setComponentEnabledSetting(a, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(b, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        } catch (Exception ignored) { /* تبقى الأيقونة القديمة */ }
    }
    // «افتراضي» = مثل ما بالملف: المطبخ شغّالة والمجهز مطفية
    private static boolean enabled(PackageManager pm, ComponentName c, String name) {
        int st = pm.getComponentEnabledSetting(c);
        return st == PackageManager.COMPONENT_ENABLED_STATE_ENABLED || (st == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && "KitchenLauncher".equals(name));
    }
}
