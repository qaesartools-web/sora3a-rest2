package iq.sora3a.cashier;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

// ثلاث تطبيقات من نفس الكود (BuildConfig.LINE / BuildConfig.SCREEN):
//  • الكاشير: نفس الكاشير من الإنترنت (أي تحديث يوصل فوراً) + طباعة مباشرة على الطابعة المدمجة والشبكة والبلوتوث
//  • خط المطعم: صفحة وحدة لربط رقم المطعم، والتلفون يبعث رقم المتصل للكاشير
//  • الشاشة: «طلبك جاهز» على التلفزيون/التيفي بوكس — ملء الشاشة، ما تطفي، وتفتح وحدها مع تشغيل الجهاز
public class MainActivity extends Activity {
    private static final String START_URL = BuildConfig.START_URL;
    private static final int REQ_BT = 7, REQ_PHONE = 8, REQ_HOME = 9;
    private WebView web;
    private volatile String pageUrl = "";

    boolean pageOriginOk() { return pageUrl.startsWith(Bridge.ORIGIN + "/"); }

    private static final int FILE_REQ = 4242;
    private ValueCallback<Uri[]> fileCb;

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQ) {
            if (fileCb != null) fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
            return;
        }
        super.onActivityResult(req, res, data);
        if (req == REQ_HOME) pushAuto();   // رجع من «الواجهة الرئيسية» ← نحدّث حالة «يفتح وحده» بقائمة الشاشة
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (!BuildConfig.LINE) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // شاشة الكاشير والتلفزيون ما تطفي
        immersive();
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
        s.setUserAgentString(s.getUserAgentString() + (BuildConfig.SCREEN ? " SoraScreenApp/" : " SoraCashierApp/") + BuildConfig.VERSION_NAME);

        // الشاشة ما تحتاج جسر الطباعة والخط — تعرض بس
        final boolean early = !BuildConfig.SCREEN && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (!BuildConfig.SCREEN) {
            Simulator sim = new Simulator(this);
            AndroidBackend backend = new AndroidBackend(this);
            HtmlRenderer renderer = new HtmlRenderer(this, root);
            web.addJavascriptInterface(new Bridge(this, web, backend, renderer, sim), "SoraPOS");
            if (early) WebViewCompat.addDocumentStartJavaScript(web, Bridge.SHIM, Collections.singleton(Bridge.ORIGIN));
        }

        // نوافذ الصفحة (تأكيد/تنبيه/إدخال) + اختيار صورة — بدون هذا الأندرويد يتجاهلها ويرجّع «لا» وحده
        //  (زر «خروج» ما كان يشتغل، وكل «متأكد؟»، ورفع صور المنيو)
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsAlert(WebView v, String url, String msg, JsResult r) {
                if (isFinishing()) { r.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setMessage(msg).setPositiveButton("تمام", (d, w) -> r.confirm())
                    .setOnCancelListener((d) -> r.cancel()).show();
                return true;
            }
            @Override public boolean onJsConfirm(WebView v, String url, String msg, JsResult r) {
                if (isFinishing()) { r.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setMessage(msg).setPositiveButton("نعم", (d, w) -> r.confirm())
                    .setNegativeButton("لا", (d, w) -> r.cancel()).setOnCancelListener((d) -> r.cancel()).show();
                return true;
            }
            @Override public boolean onJsPrompt(WebView v, String url, String msg, String def, JsPromptResult r) {
                if (isFinishing()) { r.cancel(); return true; }
                final EditText in = new EditText(MainActivity.this);
                in.setText(def == null ? "" : def); in.setSingleLine(true); in.selectAll();
                new AlertDialog.Builder(MainActivity.this).setMessage(msg).setView(in)
                    .setPositiveButton("تمام", (d, w) -> r.confirm(in.getText().toString()))
                    .setNegativeButton("إلغاء", (d, w) -> r.cancel()).setOnCancelListener((d) -> r.cancel()).show();
                return true;
            }
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try { startActivityForResult(params.createIntent(), FILE_REQ); }
                catch (ActivityNotFoundException e) { fileCb = null; cb.onReceiveValue(null); return false; }
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                // الشاشة: زر «يفتح وحده مع التلفزيون» بقائمة ⚙️
                if (BuildConfig.SCREEN && "sora3a".equals(u.getScheme())) {
                    if ("autostart".equals(u.getHost())) { setAutoStart("1".equals(u.getQueryParameter("on"))); pushAuto(); }
                    else if ("autodiag".equals(u.getHost())) autoDiag();
                    else if ("update".equals(u.getHost())) { if (update != null) doUpdate(update); else checkUpdate(true); }
                    return true;
                }
                if ("https".equals(u.getScheme()) && "qaesartools-web.github.io".equals(u.getHost())) return false;
                leave();
                try { startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (ActivityNotFoundException ignored) {}
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                pageUrl = url == null ? "" : url;
                if (!BuildConfig.SCREEN && !early && pageOriginOk()) v.evaluateJavascript(Bridge.SHIM, null);
            }
            @Override public void onPageFinished(WebView v, String url) { if (BuildConfig.SCREEN) { checkPageWorks(); pushAuto(); } }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) { pageUrl = url == null ? "" : url; }
            @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) v.loadDataWithBaseURL(null, OFFLINE, "text/html", "utf-8", null);
            }
        });
        if (state != null) web.restoreState(state); else web.loadUrl(START_URL);
        web.postDelayed(updTick, 10_000);
        if (BuildConfig.SCREEN) {
            logHome(getIntent());
            checkKilled();   // قبل ScreenWatch.sync اللي يرجّع المنبّه
            if (webViewMajor() > 0 && webViewMajor() < MIN_WEBVIEW) webViewTooOld();
            web.postDelayed(this::askAutoStart, 4000);
            ScreenWatch.sync(this, false);
        }
    }

    // ── الشاشة: ملء الشاشة، محرك الإنترنت، والتشغيل مع الجهاز ──
    // الصفحة تحتاج كروم 61 فما فوق (ES modules) — أندرويد 9 بالتلفزيونات يجي عادة بـ 66 أو أحدث
    private static final int MIN_WEBVIEW = 61;
    private boolean warnedWv, reloadedOnce;
    private void immersive() {
        if (!BuildConfig.SCREEN) return;
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean focus) { super.onWindowFocusChanged(focus); if (focus) immersive(); }

    private PackageInfo webViewPkg() { try { return WebViewCompat.getCurrentWebViewPackage(this); } catch (Exception e) { return null; } }
    int webViewMajor() {
        PackageInfo p = webViewPkg();
        try { return Integer.parseInt(p.versionName.split("\\.")[0]); } catch (Exception e) { return 0; }
    }
    // البوكسات القديمة: محرك الإنترنت (Android System WebView) قديم وما يفتح الصفحة ← نطلب تحديثه
    private void checkPageWorks() {
        if (web == null || !pageUrl.startsWith(START_URL)) return;
        web.postDelayed(() -> {
            if (web == null || !pageUrl.startsWith(START_URL)) return;
            web.evaluateJavascript("!!window.__scrOk", (r) -> {
                if ("true".equals(r)) return;
                int m = webViewMajor();
                if (m > 0 && m < 90) webViewTooOld();
                else if (!reloadedOnce) { reloadedOnce = true; web.reload(); }   // غالباً نت بطيء
            });
        }, 25000);
    }
    void webViewTooOld() {
        if (warnedWv || isFinishing()) return;
        warnedWv = true;
        PackageInfo p = webViewPkg();
        String ver = p == null || p.versionName == null ? "غير معروفة" : p.versionName;
        String pkg = p == null ? "com.google.android.webview" : p.packageName;
        new AlertDialog.Builder(this).setTitle("يحتاج تحديث بسيط بالجهاز")
            .setMessage("الشاشة تحتاج نسخة أحدث من «Android System WebView» (محرك الإنترنت بالجهاز).\nالنسخة الحالية: " + ver
                + "\n\nحدّثه من Google Play، وبعدها سكّر التطبيق وافتحه من جديد.\nإذا ما يتحدّث، صوّر هاي الرسالة ودزّها لفريق سرعة.")
            .setPositiveButton("تحديث من Google Play", (d, w) -> openStore(pkg))
            .setNegativeButton("لاحقاً", null).show();
    }
    private void openStore(String pkg) {
        if (!openSettings(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
            openSettings(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    // «يفتح وحده مع التلفزيون»: الطريقة المضمونة = الشاشة تصير الواجهة الرئيسية للتلفزيون (Home).
    //   أي تشغيل للتلفزيون أو رجوع من الستاند باي أو زر 🏠 بالريموت ← تطلع الشاشة. ما تحتاج أي إذن خاص.
    //   (الطريقة القديمة — «الظهور فوق التطبيقات» + ScreenWatch — تبقى احتياط للأجهزة اللي تسمح بيها)
    private void askAutoStart() {
        if (isFinishing() || !appPrefs().getBoolean("autoStart", true) || isHome() || appPrefs().getBoolean("askedHome", false)) return;
        appPrefs().edit().putBoolean("askedHome", true).apply();
        new AlertDialog.Builder(this).setTitle("تفتح وحدها مع التلفزيون")
            .setMessage("حتى تفتح الشاشة وحدها كل ما يشتغل التلفزيون (حتى بعد ما تنطفي الكهرباء)، نخليها الواجهة الرئيسية للتلفزيون.\n\nبالرسالة الجاية اختار «سرعة - الشاشة» واضغط «دائماً» (Always).\n\nتكدر ترجع لواجهة التلفزيون العادية بأي وقت من ⚙️ بالشاشة.")
            .setPositiveButton("تمام", (d, w) -> { setHomeAlias(true); askHome(); }).setNegativeButton("لاحقاً", null).show();
    }
    private ComponentName homeAlias() { return new ComponentName(this, MainActivity.class.getPackage().getName() + ".TvHome"); }
    private void setHomeAlias(boolean on) {
        try { getPackageManager().setComponentEnabledSetting(homeAlias(), on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP); } catch (Exception ignored) {}
    }
    // هل الشاشة هي الواجهة الرئيسية هسه؟
    boolean isHome() {
        if (!BuildConfig.SCREEN) return false;
        try {
            ResolveInfo r = getPackageManager().resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
            return r != null && r.activityInfo != null && getPackageName().equals(r.activityInfo.packageName);
        } catch (Exception e) { return false; }
    }
    // نطلب من التلفزيون يخليها الواجهة الرئيسية: رسالة النظام (أندرويد 10+)، أو صفحة «التطبيق الرئيسي»، أو قائمة الاختيار
    private void askHome() {
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                RoleManager rm = getSystemService(RoleManager.class);
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME) && !rm.isRoleHeld(RoleManager.ROLE_HOME)) { leave(); startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), REQ_HOME); return; }
            } catch (Exception ignored) {}
        }
        if (openSettings(new Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))) return;
        if (openSettings(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))) return;
        if (Build.VERSION.SDK_INT >= 29 && !overlayOk()) openPerm("overlay");   // آخر حل
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
    boolean autoStartOn() { return appPrefs().getBoolean("autoStart", true) && (isHome() || Build.VERSION.SDK_INT < 29 || overlayOk()); }
    boolean setAutoStart(boolean on) {
        appPrefs().edit().putBoolean("autoStart", on).apply();
        ScreenWatch.sync(this, false);
        if (BuildConfig.SCREEN) {
            // تشغيل: تصير الواجهة الرئيسية. إطفاء: نشيلها، والتلفزيون يرجع لواجهته وحده
            setHomeAlias(on);
            if (on && !isHome()) askHome();
            return autoStartOn();
        }
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
                case "overlay":
                    // بعض أجهزة التلفزيون ما بيها هاي الشاشة ← صفحة التطبيق بالإعدادات
                    if (!openSettings(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + pkg))))
                        openSettings(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));
                    return;
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
        leave();   // المطعم هو اللي فتحها من الشاشة ← لا نرجّعه للشاشة غصب
        try { startActivity(i); return true; } catch (Exception e) { return false; }
    }

    // رجعنا من شاشة الأذونات ← الكاشير يحدّث حالة الخط
    private void notifyPage() {
        if (web != null && pageOriginOk()) web.evaluateJavascript("window.dispatchEvent(new Event('sora:resume'))", null);
    }
    @Override protected void onResume() { super.onResume(); leaving = false; notifyPage(); if (BuildConfig.SCREEN) pushAuto(); }
    // الشاشة: المطعم نفسه طالع منها (إعدادات، رابط، تحديث...) ← لا ترجع وحدها فوق اللي فتحه
    private boolean leaving;
    private void leave() { leaving = true; ScreenWatch.pause(this); }
    // الشاشة: نبلّغ الصفحة هل «يفتح وحده مع التلفزيون» شغّال (يطلع بقائمة ⚙️)
    private void pushAuto() {
        if (web == null || !pageUrl.startsWith(START_URL)) return;
        boolean on = autoStartOn();
        String up = update == null ? "" : update.name.replaceAll("[^0-9.]", "");
        web.evaluateJavascript("window.__autoState=" + on + ";window.__autoDiag=1;window.__setAuto&&window.__setAuto(" + on + ")"
            + ";window.__appUpdate='" + up + "';window.__setUpdate&&window.__setUpdate('" + up + "')", null);
    }

    // ── التحديث من داخل التطبيق (Updater): نفحص بعد التشغيل بشوية وكل 6 ساعات ──
    private Updater.Info update;
    private AlertDialog updDlg;
    private final Runnable updTick = new Runnable() {
        @Override public void run() { if (isFinishing()) return; checkUpdate(false); web.postDelayed(this, 6 * 3600_000L); }
    };
    private void checkUpdate(boolean manual) {
        new Thread(() -> {
            Updater.Info u = Updater.check(this);
            runOnUiThread(() -> {
                if (isFinishing()) return;
                update = u;
                if (BuildConfig.SCREEN) pushAuto();   // زر «تحديث التطبيق» بقائمة ⚙️
                if (u == null) { if (manual) Toast.makeText(this, "التطبيق آخر نسخة ✅", Toast.LENGTH_LONG).show(); return; }
                if (manual || System.currentTimeMillis() > appPrefs().getLong("updLater", 0)) askUpdate(u);
            });
        }).start();
    }
    private void updLater(long ms) { appPrefs().edit().putLong("updLater", System.currentTimeMillis() + ms).apply(); }
    private void askUpdate(Updater.Info u) {
        if (updDlg != null && updDlg.isShowing()) return;
        updDlg = new AlertDialog.Builder(this).setTitle("⬆️ تحديث جديد — نسخة " + u.name)
            .setMessage("التحديث ينزل وينصب من هنا: بدون فلاشة، وبدون ما ينمسح شي أو تسجّل دخول من جديد.\n\nبعد التنزيل تطلع رسالة الجهاز ← اضغط «تثبيت».")
            .setPositiveButton("تحديث هسه", (d, w) -> doUpdate(u))
            .setNegativeButton("بعدين", (d, w) -> updLater(24 * 3600_000L)).show();
        // الشاشة: الرسالة ما تبقى فوق الطلبات — تختفي بعد دقيقة (والتحديث يبقى بقائمة ⚙️)
        if (BuildConfig.SCREEN) { final AlertDialog d = updDlg; web.postDelayed(() -> { if (d.isShowing()) { d.dismiss(); updLater(6 * 3600_000L); } }, 60_000); }
    }
    private void doUpdate(Updater.Info u) {
        if (updDlg != null && updDlg.isShowing()) updDlg.dismiss();
        leave();   // رسالة التثبيت تطلع فوق الشاشة — لا نرجّعها فوقها
        final AlertDialog dl = new AlertDialog.Builder(this).setTitle("⬆️ تحديث — نسخة " + u.name).setMessage("⬇️ ينزل التحديث…").setCancelable(false).show();
        new Thread(() -> {
            try {
                File f = new File(getCacheDir(), "update.apk");
                Updater.download(f, (p) -> runOnUiThread(() -> dl.setMessage("⬇️ ينزل التحديث… " + (p >= 0 ? p + "%" : ""))));
                runOnUiThread(() -> dl.setMessage("📦 يتجهز التثبيت…"));
                Updater.install(this, f);
                runOnUiThread(dl::dismiss);
            } catch (Exception e) {
                AutoLog.add(this, "err", "update " + e.getClass().getSimpleName());
                runOnUiThread(() -> { dl.dismiss(); Toast.makeText(this, "❌ ما كدرنا ننزّل التحديث — تأكد من الإنترنت وجرّب مرة ثانية", Toast.LENGTH_LONG).show(); });
            }
        }).start();
    }
    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); if (BuildConfig.SCREEN) logHome(i); }
    // انفتحت لأنها الواجهة الرئيسية = غالباً التلفزيون هسه اشتغل (أو زر 🏠).
    //   بعض التلفزيونات (مثل MediaTek) تفتح الواجهة الرئيسية وبعد ثواني تفتح القنوات/المصدر فوقها، وما تبعث «الشاشة اشتغلت»
    //   ← نحرس الشاشة دقيقتين ونرجّعها قدام إذا شي غطّاها
    private void logHome(Intent i) {
        if (i == null || !i.hasCategory(Intent.CATEGORY_HOME)) return;
        AutoLog.add(this, "home", "");
        if (appPrefs().getBoolean("autoStart", true)) ScreenWatch.ensure(this, ScreenWatch.HOME_GUARD);
    }
    // الشاشة راحت للخلف: إذا مو المطعم اللي طلع منها (يعني التلفزيون غطّاها بواجهته أو HDMI أو القنوات) ← ترجع وحدها بعد 20 ثانية
    @Override protected void onStop() {
        super.onStop();
        if (!BuildConfig.SCREEN || isFinishing()) return;
        AutoLog.add(this, "bg", leaving ? "me" : "");
        if (!leaving && appPrefs().getBoolean("autoStart", true)) ScreenWatch.away(this);
    }

    // التلفزيون يسكّر التطبيق بالقوة من ينطفي (منبّه المراقبة وقف بدون ما ينطفي الجهاز)، أو اشتغل وما بلّغه؟
    //   هذا شي ما يكدر أي تطبيق يتجاوزه — نسجّله ونطلع للمطعم بالتلفزيون نفسه شنو يغيّر بالإعدادات
    private static boolean checked;   // مرة وحدة لكل تشغيل للعملية (بعد السكّر بالقوة العملية دائماً جديدة، والقراءة من الملف مو من الذاكرة)
    private void checkKilled() {
        if (checked) return;
        checked = true;
        SharedPreferences p = appPrefs();
        if (!p.getBoolean("autoStart", true) || !p.getBoolean("tickArmed", false) || p.getInt("armedVer", -1) != BuildConfig.VERSION_CODE) return;
        int boot = Tick.bootCount(this);
        if (boot < 0) return;
        long now = SystemClock.elapsedRealtime(), tick = getSharedPreferences("watch", 0).getLong("tick", 0);
        String why = null;
        if (boot == p.getInt("armedBoot", -2)) {
            // المنبّه يدقّ كل دقيقة (حتى اللي فاته وقته بالستاند باي يدقّ أول ما يصحى) — إذا بطّل بنفس التشغيل = انسكّر بالقوة
            if (tick > 0 && tick < now && now - tick > 150_000) { why = "killed"; AutoLog.add(this, why, String.valueOf((now - tick) / 60000)); }
        } else if (now > 180_000) { why = "noboot"; AutoLog.add(this, why, ""); }   // اشتغل من جديد وما وصلنا «التشغيل»
        final String w = why;
        if (w != null && System.currentTimeMillis() > p.getLong("killWarnUntil", 0)) web.postDelayed(() -> warnKilled(w), 6000);
    }
    private void warnKilled(String why) {
        if (isFinishing()) return;
        appPrefs().edit().putLong("killWarnUntil", System.currentTimeMillis() + 12 * 3600_000L).apply();
        String msg = "killed".equals(why)
            ? "التلفزيون يسكّر «سرعة - الشاشة» بالقوة من ينطفي بالريموت، وهذا يمنعها ترجع وحدها (ما يكدر أي تطبيق يرجع بعدها).\n\n"
              + "الحل بإعدادات التلفزيون، وحدة من هذني:\n"
              + "• طفّي «التشغيل السريع» (Quick Start أو Instant On أو Fast Boot): التلفزيون يشتغل من جديد كل مرة، والشاشة تفتح وحدها مع التشغيل.\n"
              + "• أو بمدير التلفزيون ضيف «سرعة - الشاشة» لـ«القائمة البيضاء» (تنظيف الذاكرة أو التسريع)."
            : "التلفزيون اشتغل وما بلّغ «سرعة - الشاشة»، فما كدرت تفتح وحدها.\n\n"
              + "الحل: بمدير التلفزيون ← «البدء الآلي» تأكد إن «سرعة - الشاشة» مفعّلة، وإذا أكو «القائمة البيضاء» ضيفها.";
        new AlertDialog.Builder(this).setTitle("⚠️ التلفزيون يمنع الشاشة ترجع وحدها").setMessage(msg)
            .setPositiveButton("فتح إعدادات التلفزيون", (d, x) -> openSettings(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
            .setNegativeButton("تمام", null).show();
    }

    // ⚙️ ← «فحص التشغيل التلقائي»: كل اللي نحتاجه حتى نعرف ليش ما انفتحت وحدها — المطعم يصوّره ويبعثه
    private void autoDiag() {
        PackageManager pm = getPackageManager();
        String home = "—";
        try {
            ResolveInfo r = pm.resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
            if (r != null && r.activityInfo != null) {
                String p = r.activityInfo.packageName;
                home = getPackageName().equals(p) ? "✅ سرعة - الشاشة" : "android".equals(p) ? "❓ ما محددة (يسأل كل مرة)" : "❌ " + r.activityInfo.loadLabel(pm) + " (" + p + ")";
            }
        } catch (Exception ignored) {}
        StringBuilder b = new StringBuilder();
        b.append("أندرويد ").append(Build.VERSION.RELEASE).append(" • ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append(" • نسخة ").append(BuildConfig.VERSION_NAME).append('\n');
        b.append("يفتح وحده: ").append(appPrefs().getBoolean("autoStart", true) ? "✅ مفعّل" : "❌ مطفي").append('\n');
        b.append("الواجهة الرئيسية: ").append(home).append('\n');
        b.append("خدمة المراقبة: ").append(watchRunning() ? "✅ شغّالة" : "❌ واقفة").append('\n');
        if (Build.VERSION.SDK_INT >= 29) b.append("الظهور فوق التطبيقات: ").append(overlayOk() ? "✅" : "❌").append('\n');
        b.append("\nآخر الأحداث (الأحدث فوق):\n");
        List<String> l = AutoLog.read(this);
        if (l.isEmpty()) b.append("— ماكو بعد\n");
        for (int i = 0; i < Math.min(14, l.size()); i++) {
            String[] p = l.get(i).split("\\|", 3);
            if (p.length < 2) continue;
            try { b.append(when12(Long.parseLong(p[0]))); } catch (Exception e) { b.append('—'); }
            b.append(" • ").append(logText(p[1], p.length > 2 ? p[2] : "")).append('\n');
        }
        new AlertDialog.Builder(this).setTitle("🩺 فحص التشغيل التلقائي").setMessage(b.toString())
            .setPositiveButton("اختيار الواجهة الرئيسية", (d, w) -> { appPrefs().edit().putBoolean("autoStart", true).apply(); ScreenWatch.sync(this, false); setHomeAlias(true); askHome(); })
            .setNegativeButton("رجوع", null).show();
    }
    private static String logText(String code, String d) {
        switch (code) {
            case "boot": return "🔌 التلفزيون اشتغل (تشغيل جديد)";
            case "wake": return "🌙 رجع من الستاند باي" + (d.isEmpty() ? "" : " بعد " + d + " دقيقة");
            case "screen-on": return "💡 الشاشة اشتغلت";
            case "svc": return "⚙️ خدمة المراقبة اشتغلت";
            case "restart": return "♻️ التلفزيون سكّر الخدمة ورجعت";
            case "open": return "🚀 فتحناها فوق التلفزيون";
            case "front": return "✅ الشاشة قدام";
            case "home": return "🏠 انفتحت كواجهة رئيسية";
            case "bg": return d.equals("me") ? "⬇️ طلعتوا من الشاشة (إعدادات/تحديث)" : "⬇️ شي غطّى الشاشة";
            case "return": return "↩️ رجّعناها قدام وحدها";
            case "killed": return "⛔ التلفزيون سكّر التطبيق بالقوة" + (d.isEmpty() ? "" : " (قبل " + d + " دقيقة)");
            case "noboot": return "⛔ التلفزيون اشتغل وما بلّغ التطبيق";
            case "updated": return "⬆️ تحدّث التطبيق لنسخة " + d;
            case "no-overlay": return "⛔ التلفزيون ما يسمح تفتح وحدها";
            default: return "⚠️ " + code + (d.isEmpty() ? "" : " " + d);
        }
    }
    private static String when12(long ms) {
        Calendar c = Calendar.getInstance(); c.setTimeInMillis(ms);
        int h = c.get(Calendar.HOUR_OF_DAY);
        return c.get(Calendar.DAY_OF_MONTH) + "/" + (c.get(Calendar.MONTH) + 1) + " " + (h % 12 == 0 ? 12 : h % 12)
            + String.format(Locale.US, ":%02d:%02d", c.get(Calendar.MINUTE), c.get(Calendar.SECOND)) + (h < 12 ? " ص" : " م");
    }
    @SuppressWarnings("deprecation")
    private boolean watchRunning() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            for (ActivityManager.RunningServiceInfo s : am.getRunningServices(50))
                if (ScreenWatch.class.getName().equals(s.service.getClassName())) return true;
        } catch (Exception ignored) {}
        return false;
    }
    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) { super.onRequestPermissionsResult(req, perms, res); notifyPage(); }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() {
        if (web.canGoBack()) { web.goBack(); return; }
        if (BuildConfig.LINE) { finish(); return; } // الخط يشتغل بالخلفية حتى والتطبيق مسكّر
        AlertDialog.Builder b = new AlertDialog.Builder(this).setMessage(BuildConfig.SCREEN ? "تريد تسكّر الشاشة؟" : "تريد تسكّر الكاشير؟")
            .setPositiveButton("إغلاق", (d, w) -> finish()).setNegativeButton("إلغاء", null);
        // الشاشة واجهة رئيسية: «إغلاق» يرجعها نفسها — فنعطي طريق لإعدادات التلفزيون دائماً
        if (BuildConfig.SCREEN) b.setNeutralButton("إعدادات التلفزيون", (d, w) -> openSettings(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        b.show();
    }

    private static final String OFFLINE = "<html dir=rtl><body style='margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0B1220;color:#EEF2F7;font-family:sans-serif;text-align:center'>"
        + "<div style='padding:24px'><div style='font-size:52px'>📶</div><h2>" + (BuildConfig.LINE ? "ما كدرنا نفتح الصفحة" : BuildConfig.SCREEN ? "ما كدرنا نفتح الشاشة" : "ما كدرنا نفتح الكاشير") + "</h2>"
        + "<p style='color:#A9B5C6;line-height:1.8'>" + (BuildConfig.LINE ? "ربط الخط يحتاج إنترنت. شغّل النت ونعيد المحاولة."
            : BuildConfig.SCREEN ? "الشاشة تحتاج إنترنت. تأكد إن البوكس متصل بالواي فاي — نعيد المحاولة وحدنا."
            : "أول تشغيل يحتاج إنترنت حتى ينحفظ الكاشير بالجهاز. بعدها يشتغل حتى لو انقطع النت.") + "</p>"
        + "<button style='font-size:18px;padding:12px 28px;border:0;border-radius:14px;background:#16A34A;color:#fff' onclick=\"location.href='" + START_URL + "'\">🔄 إعادة المحاولة</button>"
        + "</div><script>setTimeout(function(){location.href='" + START_URL + "'},10000)</script></body></html>";
}
