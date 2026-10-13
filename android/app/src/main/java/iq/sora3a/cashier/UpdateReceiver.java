package iq.sora3a.cashier;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

// جواب مثبّت الأندرويد على التحديث: يحتاج موافقة ← نفتح رسالة «تثبيت»، وإذا فشل نبيّن السبب
public class UpdateReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @SuppressWarnings("deprecation") Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm == null) return;
            ScreenWatch.pause(c);   // الشاشة لا ترجع فوق رسالة التثبيت
            try { c.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
            return;
        }
        if (st == PackageInstaller.STATUS_SUCCESS) return;   // التطبيق يتسكّر ويرجع بالنسخة الجديدة
        String m = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        AutoLog.add(c, "err", "update " + st + (m == null ? "" : " " + m));
        Toast.makeText(c, st == PackageInstaller.STATUS_FAILURE_ABORTED ? "انلغى التحديث" : "ما تم التحديث" + (m == null ? "" : ": " + m), Toast.LENGTH_LONG).show();
    }
}
