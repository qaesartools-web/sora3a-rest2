package iq.sora3a.cashier;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;

// مكالمة واردة على الشريحة ← رقم المتصل يطلع بكاشير المطعم (حتى والتطبيق مسكّر)
public class PhoneReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        if (!TelephonyManager.EXTRA_STATE_RINGING.equals(intent.getStringExtra(TelephonyManager.EXTRA_STATE))) return;
        @SuppressWarnings("deprecation")
        String number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER); // يوصل بس مع إذن سجل المكالمات
        if (number == null || number.isEmpty()) return;
        final PendingResult pr = goAsync(); // نخلي التطبيق صاحي لحد ما يوصل الرقم
        LineStore.report(ctx, number, false, pr::finish);
    }
}
