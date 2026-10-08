package iq.sora3a.cashier;

import android.app.Application;
import android.webkit.WebView;

public class App extends Application {
    @Override public void onCreate() {
        super.onCreate();
        // لازم قبل أي WebView: حتى نرسم الفاتورة كاملة كصورة للطباعة
        WebView.enableSlowWholeDocumentDraw();
    }
}
