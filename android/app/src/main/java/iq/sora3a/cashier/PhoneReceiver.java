package iq.sora3a.cashier;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;

// مكالمة واردة على الشريحة ← رقم المتصل يطلع بكاشير المطعم (حتى والتطبيق مسكّر)
//  بالتلفون أبو شريحتين: نعرف أي شريحة رنّت حتى توصل لخط رقمها (والشريحة غير المربوطة ما توصل)
public class PhoneReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        if (!TelephonyManager.EXTRA_STATE_RINGING.equals(intent.getStringExtra(TelephonyManager.EXTRA_STATE))) return;
        @SuppressWarnings("deprecation")
        String number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER); // يوصل بس مع إذن سجل المكالمات
        if (number == null || number.isEmpty()) return;
        Bundle x = intent.getExtras();
        int subId = intExtra(x, "android.telephony.extra.SUBSCRIPTION_INDEX", "subscription", "subscription_id", "sub_id", "subId");
        int slot = intExtra(x, "android.telephony.extra.SLOT_INDEX", "slot", "simId", "simSlot", "slot_id", "slotId", "phone");
        if (slot < 0 && subId >= 0) slot = slotOf(ctx, subId);
        final PendingResult pr = goAsync(); // نخلي التطبيق صاحي لحد ما يوصل الرقم
        LineStore.reportSim(ctx, number, subId, slot, pr::finish);
    }

    // كل شركة تحط رقم الشريحة باسم مختلف
    static int intExtra(Bundle b, String... keys) {
        if (b == null) return -1;
        for (String k : keys) {
            Object v = b.get(k);
            if (v instanceof Number) { int n = ((Number) v).intValue(); if (n >= 0 && n < Integer.MAX_VALUE) return n; }
            if (v instanceof String) try { int n = Integer.parseInt((String) v); if (n >= 0) return n; } catch (NumberFormatException ignored) {}
        }
        return -1;
    }

    static int slotOf(Context ctx, int subId) {
        if (ctx.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return -1;
        try {
            SubscriptionInfo i = ctx.getSystemService(SubscriptionManager.class).getActiveSubscriptionInfo(subId);
            return i == null ? -1 : i.getSimSlotIndex();
        } catch (SecurityException | NullPointerException e) { return -1; }
    }
}
