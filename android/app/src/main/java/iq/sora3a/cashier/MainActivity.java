package iq.sora3a.cashier;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;

// تطبيق الكاشير للأندرويد: نفس الكاشير من الإنترنت (أي تحديث يوصل فوراً) + طباعة مباشرة
// على الطابعة المدمجة بالجهاز، وطابعات الشبكة والبلوتوث — بدون أي برنامج ثاني
public class MainActivity extends Activity {
    private static final String START_URL = "https://qaesartools-web.github.io/sora3a-rest2/";
    private static final int REQ_BT = 7, REQ_PHONE = 8;
    private WebView web;
    private volatile String pageUrl = "";

    boolean pageOriginOk() { return pageUrl.startsWith(Bridge.ORIGIN + "/"); }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // شاشة الكاشير ما تطفي
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // رنة المكالمات والطلبات
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " SoraCashierApp/" + BuildConfig.VERSION_NAME);

        Simulator sim = new Simulator(this);
        AndroidBackend backend = new AndroidBackend(this);
        HtmlRenderer renderer = new HtmlRenderer(this, root);
        web.addJavascriptInterface(new Bridge(this, web, backend, renderer, sim), "SoraPOS");
        boolean early = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (early) WebViewCompat.addDocumentStartJavaScript(web, Bridge.SHIM, Collections.singleton(Bridge.ORIGIN));

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equals(u.getScheme()) && "qaesartools-web.github.io".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (ActivityNotFoundException ignored) {}
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                pageUrl = url == null ? "" : url;
                if (!early && pageOriginOk()) v.evaluateJavascript(Bridge.SHIM, null);
            }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) { pageUrl = url == null ? "" : url; }
            @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) v.loadDataWithBaseURL(null, OFFLINE, "text/html", "utf-8", null);
            }
        });
        if (state != null) web.restoreState(state); else web.loadUrl(START_URL);
    }

    // البلوتوث (أندرويد 12+) — حتى تطلع الطابعة المدمجة وطابعات البلوتوث
    void ensureBluetoothPermission() {
        if (Build.VERSION.SDK_INT < 31) return;
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) return;
        runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, REQ_BT));
    }

    // ── خط المطعم وتشغيل الكاشير مع الجهاز: الأذونات اللي يحتاجها ──
    private boolean has(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }
    boolean phoneOk() { return has(Manifest.permission.READ_PHONE_STATE) && has(Manifest.permission.READ_CALL_LOG); }
    boolean hasSim() { return getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY); }
    boolean notifOk() {
        String s = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return s != null && s.contains(getPackageName() + "/");
    }
    boolean overlayOk() { return Settings.canDrawOverlays(this); }
    boolean batteryOk() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        return pm == null || pm.isIgnoringBatteryOptimizations(getPackageName());
    }
    private SharedPreferences appPrefs() { return getSharedPreferences("app", 0); }
    // أندرويد 10+ يحتاج «الظهور فوق التطبيقات» حتى يفتح الكاشير وحده بعد تشغيل الجهاز
    boolean autoStartOn() { return appPrefs().getBoolean("autoStart", true) && (Build.VERSION.SDK_INT < 29 || overlayOk()); }
    boolean setAutoStart(boolean on) {
        appPrefs().edit().putBoolean("autoStart", on).apply();
        if (on && Build.VERSION.SDK_INT >= 29 && !overlayOk()) openPerm("overlay");
        return autoStartOn();
    }

    void openPerm(String kind) {
        runOnUiThread(() -> {
            String pkg = getPackageName();
            switch (kind) {
                case "phone": {
                    String[] ps = {Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG};
                    boolean asked = appPrefs().getBoolean("askedPhone", false);
                    boolean blocked = asked && !shouldShowRequestPermissionRationale(ps[0]) && !shouldShowRequestPermissionRationale(ps[1]);
                    if (phoneOk() || blocked) { openSettings(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg))); return; }
                    appPrefs().edit().putBoolean("askedPhone", true).apply();
                    requestPermissions(ps, REQ_PHONE);
                    return;
                }
                case "notif": {
                    Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                    if (Build.VERSION.SDK_INT >= 30) {
                        Intent d = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                            .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, new ComponentName(this, WaListener.class).flattenToString());
                        if (d.resolveActivity(getPackageManager()) != null) i = d;
                    }
                    openSettings(i);
                    return;
                }
                case "overlay": openSettings(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + pkg))); return;
                case "battery": {
                    @SuppressLint("BatteryLife")
                    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
                    if (!openSettings(i)) openSettings(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    return;
                }
                default: openSettings(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));
            }
        });
    }
    private boolean openSettings(Intent i) {
        try { startActivity(i); return true; } catch (Exception e) { return false; }
    }

    // رجعنا من شاشة الأذونات ← الكاشير يحدّث حالة الخط
    private void notifyPage() {
        if (web != null && pageOriginOk()) web.evaluateJavascript("window.dispatchEvent(new Event('sora:resume'))", null);
    }
    @Override protected void onResume() { super.onResume(); notifyPage(); }
    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) { super.onRequestPermissionsResult(req, perms, res); notifyPage(); }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() {
        if (web.canGoBack()) { web.goBack(); return; }
        new AlertDialog.Builder(this).setMessage("تريد تسكّر الكاشير؟")
            .setPositiveButton("إغلاق", (d, w) -> finish()).setNegativeButton("إلغاء", null).show();
    }

    private static final String OFFLINE = "<html dir=rtl><body style='margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0B1220;color:#EEF2F7;font-family:sans-serif;text-align:center'>"
        + "<div style='padding:24px'><div style='font-size:52px'>📶</div><h2>ما كدرنا نفتح الكاشير</h2>"
        + "<p style='color:#A9B5C6;line-height:1.8'>أول تشغيل يحتاج إنترنت حتى ينحفظ الكاشير بالجهاز. بعدها يشتغل حتى لو انقطع النت.</p>"
        + "<button style='font-size:18px;padding:12px 28px;border:0;border-radius:14px;background:#16A34A;color:#fff' onclick=\"location.href='" + START_URL + "'\">🔄 إعادة المحاولة</button>"
        + "</div><script>setTimeout(function(){location.href='" + START_URL + "'},10000)</script></body></html>";
}
