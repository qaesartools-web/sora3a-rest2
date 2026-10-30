package iq.sora3a.cashier;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.function.IntConsumer;

// التحديث من داخل التطبيق: نقرا version.json من نفس مكان التنزيل، وإذا أكو نسخة أحدث موقّعة بنفس المفتاح
// ننزّلها ونفتح رسالة التثبيت (المطعم يضغط «تثبيت» بس) — بدون فلاشة، بدون حذف، والتطبيق ما ينسى تسجيل الدخول.
// إذا النسخة الجديدة موقّعة بمفتاح ثاني (بناء بدون SIGN_SEED) ما نعرضها، لأن الأندرويد يرفض ينصبها فوق.
final class Updater {
    private static final String BASE = "https://github.com/qaesartools-web/sora3a-rest2/releases/download/";

    private Updater() {}

    static final class Info {
        final int version; final String name;
        Info(int version, String name) { this.version = version; this.name = name; }
    }

    private static String tag() { return BuildConfig.SCREEN ? "screen-android" : BuildConfig.LINE ? "line-android" : BuildConfig.PREP ? "prep-android" : BuildConfig.KITCHEN ? "kitchen-android" : "cashier-android"; }
    static String apkUrl() { return BASE + tag() + "/" + (BuildConfig.SCREEN ? "sora3a-screen.apk" : BuildConfig.LINE ? "sora3a-line.apk" : BuildConfig.PREP ? "sora3a-prep.apk" : BuildConfig.KITCHEN ? "sora3a-kitchen.apk" : "sora3a-cashier.apk"); }

    // من خيط بالخلفية. null = ماكو تحديث (أو ماكو إنترنت، أو التوقيع مو نفسه)
    static Info check(Context ctx) {
        try {
            JSONObject j = new JSONObject(new String(get(BASE + tag() + "/version.json"), StandardCharsets.UTF_8));
            int v = j.optInt("version");
            String cert = j.optString("cert", "");
            if (v <= BuildConfig.VERSION_CODE || cert.isEmpty() || !cert.equalsIgnoreCase(myCert(ctx))) return null;
            return new Info(v, j.optString("name", "1." + v));
        } catch (Exception e) { return null; }
    }

    // بصمة شهادة التوقيع (SHA-256) — نفس اللي يطبعها tools/signkey.py
    @SuppressWarnings("deprecation")
    static String myCert(Context ctx) {
        try {
            PackageManager pm = ctx.getPackageManager();
            Signature[] s;
            if (Build.VERSION.SDK_INT >= 28) {
                SigningInfo si = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES).signingInfo;
                s = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
            } else {
                s = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNATURES).signatures;
            }
            if (s == null || s.length == 0) return "";
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s[s.length - 1].toByteArray());
            StringBuilder b = new StringBuilder();
            for (byte x : d) b.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));   // أرقام إنكليزية دائماً
            return b.toString();
        } catch (Exception e) { return ""; }
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        return c;
    }

    private static byte[] get(String url) throws Exception {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[8192];
            for (int n; (n = in.read(b)) > 0; ) out.write(b, 0, n);
            return out.toByteArray();
        } finally { c.disconnect(); }
    }

    static void download(File to, IntConsumer pct) throws Exception {
        HttpURLConnection c = open(apkUrl());
        long total = c.getContentLength(), done = 0;
        int last = -1;
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(to)) {
            byte[] b = new byte[65536];
            for (int n; (n = in.read(b)) > 0; ) {
                out.write(b, 0, n);
                done += n;
                int p = total > 0 ? (int) (done * 100 / total) : -1;
                if (p != last) { last = p; pct.accept(p); }
            }
        } finally { c.disconnect(); }
    }

    // نسلّم الملف لمثبّت الأندرويد؛ هو يطلع رسالة «تثبيت» (UpdateReceiver يفتحها)
    static void install(Context ctx, File apk) throws Exception {
        PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(ctx.getPackageName());
        int id = pi.createSession(sp);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (OutputStream out = s.openWrite("update.apk", 0, apk.length()); InputStream in = new FileInputStream(apk)) {
                byte[] b = new byte[65536];
                for (int n; (n = in.read(b)) > 0; ) out.write(b, 0, n);
                s.fsync(out);
            }
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            s.commit(PendingIntent.getBroadcast(ctx, id, new Intent(ctx, UpdateReceiver.class), fl).getIntentSender());
        }
    }
}
