package iq.sora3a.cashier;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.SystemClock;

// تطبيق الشاشة: احتياط بدون أي إعداد — مهمة دورية «محفوظة». الأندرويد يرجّعها وحده بعد كل تشغيل للجهاز
// (حتى لو التلفزيون ما بلّغ التطبيق بالتشغيل)، فأول ما تدق بعد التشغيل نفتح الشاشة ونحرسها.
public class BootJob extends JobService {
    private static final int ID = 41;
    private static final long FRESH_BOOT = 10 * 60_000L;

    static void schedule(Context ctx, boolean on) {
        try {
            JobScheduler js = ctx.getSystemService(JobScheduler.class);
            if (!on) { js.cancel(ID); return; }
            if (js.getPendingJob(ID) != null) return;
            js.schedule(new JobInfo.Builder(ID, new ComponentName(ctx, BootJob.class)).setPersisted(true).setPeriodic(15 * 60_000L).build());
        } catch (Exception e) { AutoLog.add(ctx, "err", "job " + e.getClass().getSimpleName()); }
    }

    @Override public boolean onStartJob(JobParameters p) {
        boolean fresh = SystemClock.elapsedRealtime() < FRESH_BOOT;   // الجهاز هسه اشتغل
        if (fresh) AutoLog.add(this, "job", "");
        ScreenWatch.unblock(this);
        if (getSharedPreferences("app", 0).getBoolean("autoStart", true)) {
            Tick.arm(this, true);
            ScreenWatch.ensure(this, fresh ? ScreenWatch.BOOT_GUARD : 0);
        }
        return false;
    }

    @Override public boolean onStopJob(JobParameters p) { return false; }
}
