package iq.sora3a.cashier;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

// مكالمة واتساب واردة (من إشعار الواتساب) ← اسم/رقم المتصل يطلع بكاشير المطعم
public class WaListener extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            Notification n = sbn.getNotification();
            if (n == null) return;
            Bundle x = n.extras;
            CharSequence title = x == null ? null : x.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = x == null ? null : x.getCharSequence(Notification.EXTRA_TEXT);
            String caller = CallLine.whatsappCaller(sbn.getPackageName(), n.category,
                title == null ? null : title.toString(), text == null ? null : text.toString());
            if (caller != null) LineStore.report(this, caller, true, null);
        } catch (Throwable ignored) {}
    }
}
