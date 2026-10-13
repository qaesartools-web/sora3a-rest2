package iq.sora3a.cashier;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// تطبيق الشاشة: سجل صغير لـ«يفتح وحده مع التلفزيون» (اشتغل الجهاز، رجع من الستاند باي، فتحناها...)
// يطلع من ⚙️ ← «فحص التشغيل التلقائي» حتى نعرف شنو صار بالتلفزيون بالضبط إذا ما انفتحت وحدها.
// ملف (مو SharedPreferences) لأن خدمة المراقبة بعملية ثانية وتكتب بيه هي هم.
final class AutoLog {
    private static final String FILE = "autostart.log";
    private static final int KEEP = 40;

    private AutoLog() {}

    static synchronized void add(Context ctx, String code, String detail) {
        if (!BuildConfig.SCREEN) return;
        String line = System.currentTimeMillis() + "|" + code + "|" + (detail == null ? "" : detail.replace('\n', ' ')) + "\n";
        File f = new File(ctx.getFilesDir(), FILE);
        write(f, line, true);
        if (f.length() > 8192) {
            List<String> l = read(ctx);
            StringBuilder b = new StringBuilder();
            for (int i = Math.min(KEEP, l.size()) - 1; i >= 0; i--) b.append(l.get(i)).append('\n');
            write(f, b.toString(), false);
        }
    }

    // الأحدث أولاً
    static synchronized List<String> read(Context ctx) {
        List<String> out = new ArrayList<>();
        File f = new File(ctx.getFilesDir(), FILE);
        if (!f.exists()) return out;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            for (String s; (s = r.readLine()) != null; ) if (!s.isEmpty()) out.add(s);
        } catch (Exception ignored) {}
        Collections.reverse(out);
        return out;
    }

    private static void write(File f, String s, boolean append) {
        try (FileOutputStream o = new FileOutputStream(f, append)) { o.write(s.getBytes(StandardCharsets.UTF_8)); } catch (Exception ignored) {}
    }
}
