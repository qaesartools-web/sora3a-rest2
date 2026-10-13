package iq.sora3a.cashier;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

// تطبيق الشاشة: «التشغيل الأقوى» — بعض التلفزيونات (مثل MediaTek) ما تبلّغ التطبيقات من تشتغل، وتسكّرها بالقوة من تنطفي.
// نظام الأندرويد نفسه يربط هالخدمة أول ما يشتغل الجهاز، ويرجّعها حتى لو انسكّر التطبيق بالقوة — بدون «إشعار التشغيل».
// منها نشغّل المراقبة، وهي تفتح الشاشة وتحرسها. ما نقرا الإشعارات ولا نستخدمها بشي.
public class ScreenListener extends NotificationListenerService {
    @Override public void onListenerConnected() {
        AutoLog.add(this, "listener", "");
        ScreenWatch.unblock(this);
        // نقرا بس (هالعملية ما تكتب بإعدادات التطبيق)
        if (!getSharedPreferences("app", 0).getBoolean("autoStart", true)) return;
        Tick.arm(this, true);
        ScreenWatch.ensure(this, ScreenWatch.BOOT_GUARD);
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {}
}
