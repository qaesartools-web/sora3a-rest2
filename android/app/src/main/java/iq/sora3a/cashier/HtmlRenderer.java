package iq.sora3a.cashier;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

// يحوّل الفاتورة/التذكرة (HTML) لصورة بعرض ورق الطابعة: 80 ملم = 576 نقطة، 58 ملم = 384
public class HtmlRenderer implements PrintEngine.Renderer {
    private static final String BASE = "https://qaesartools-web.github.io/sora3a-rest2/";
    // نفس برنامج الويندوز: إذا المحتوى أعرض من الورق نصغّره، وبعدها نقيس الطول الحقيقي
    private static final String FIT_AND_MEASURE = "(function(){var d=document.documentElement,b=document.body;if(!b)return 40;"
        + "var W=d.clientWidth||innerWidth,sw=Math.max(d.scrollWidth,b.scrollWidth);if(sw>W+1)d.style.zoom=String(W/sw);"
        + "var r=b.getBoundingClientRect(),cs=getComputedStyle(b);"
        + "return Math.ceil(Math.max(b.scrollHeight,r.height+parseFloat(cs.marginTop)+parseFloat(cs.marginBottom),40));})()";

    private final Activity act;
    private final FrameLayout host;
    private final Object lock = new Object();

    public HtmlRenderer(Activity act, FrameLayout host) { this.act = act; this.host = host; }

    static String prepare(String html) {
        String style = "<style>@page{margin:0}html,body{margin:0;background:#fff}::-webkit-scrollbar{display:none}</style>";
        if (html.matches("(?is).*<head[^>]*>.*")) return html.replaceFirst("(?i)(<head[^>]*>)", "$1" + style);
        if (html.matches("(?is).*<html[^>]*>.*")) return html.replaceFirst("(?i)(<html[^>]*>)", "$1<head>" + style + "</head>");
        return "<html><head><meta charset=\"utf-8\">" + style + "</head><body>" + html + "</body></html>";
    }

    @Override
    public PrintEngine.Page render(String html, int widthMm) throws Exception {
        synchronized (lock) {
            PrintEngine.Page p = renderOnce(html, widthMm, 300);
            // بعض الأجهزة ترسم أول مرة فارغ — نعيد بمهلة أطول
            if (isBlank(p) && html.replaceAll("<[^>]*>", "").trim().length() > 0) p = renderOnce(html, widthMm, 900);
            return p;
        }
    }

    private static boolean isBlank(PrintEngine.Page p) { for (boolean b : p.black) if (b) return false; return true; }

    private PrintEngine.Page renderOnce(String html, int widthMm, int settleMs) throws Exception {
        final int dots = EscPos.dotsFor(widthMm);
        final int cssW = widthMm <= 60 ? 219 : 302;
        final float scale = dots / (float) cssW;
        CompletableFuture<PrintEngine.Page> f = new CompletableFuture<>();
        act.runOnUiThread(() -> {
            WebView v;
            try { v = new WebView(act); } catch (Throwable t) { f.completeExceptionally(t); return; }
            final WebView wv = v;
            wv.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            wv.setBackgroundColor(Color.WHITE);
            wv.setVerticalScrollBarEnabled(false);
            wv.setHorizontalScrollBarEnabled(false);
            WebSettings s = wv.getSettings();
            s.setJavaScriptEnabled(true);
            s.setUseWideViewPort(false);
            s.setLoadWithOverviewMode(false);
            s.setAllowFileAccess(false);
            s.setTextZoom(100);
            // بدون حساب كثافة الشاشة: كل بكسل CSS = scale نقطة طباعة
            wv.setInitialScale(Math.round(scale * 100));
            wv.setTranslationX(-30000);
            host.addView(wv, new FrameLayout.LayoutParams(dots, 200));
            final Runnable cleanup = () -> { try { host.removeView(wv); wv.destroy(); } catch (Throwable ignored) {} };
            wv.setWebViewClient(new WebViewClient() {
                boolean done = false;
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest r) { return true; }
                @Override public void onPageFinished(WebView view, String url) {
                    if (done) return; done = true;
                    view.postDelayed(() -> view.evaluateJavascript(FIT_AND_MEASURE, val -> {
                        int cssH;
                        try { cssH = (int) Double.parseDouble(val); } catch (Exception e) { cssH = 600; }
                        final int h = Math.max(40, Math.min(20000, (int) Math.ceil(cssH * scale)));
                        view.setLayoutParams(new FrameLayout.LayoutParams(dots, h));
                        view.measure(View.MeasureSpec.makeMeasureSpec(dots, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
                        view.layout(0, 0, dots, h);
                        view.postDelayed(() -> {
                            try {
                                Bitmap bmp = Bitmap.createBitmap(dots, h, Bitmap.Config.ARGB_8888);
                                Canvas c = new Canvas(bmp);
                                c.drawColor(Color.WHITE);
                                view.draw(c);
                                int[] px = new int[dots * h];
                                bmp.getPixels(px, 0, dots, 0, 0, dots, h);
                                f.complete(new PrintEngine.Page(EscPos.threshold(px, dots, h, 160), dots, h, bmp));
                            } catch (Throwable t) { f.completeExceptionally(t); }
                            finally { cleanup.run(); }
                        }, settleMs);
                    }), 200);
                }
            });
            wv.loadDataWithBaseURL(BASE, prepare(html), "text/html", "utf-8", null);
        });
        return f.get(20, TimeUnit.SECONDS);
    }
}
