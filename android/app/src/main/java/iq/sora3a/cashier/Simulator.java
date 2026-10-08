package iq.sora3a.cashier;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

// محاكي الطابعات: الورق اللي كان راح ينطبع يطلع على الشاشة (لوضع التجربة)
public class Simulator {
    private static final class Paper { final String printer, title; final int copies; final Bitmap bmp; final long at;
        Paper(String p, String t, int c, Bitmap b) { printer = p; title = t; copies = c; bmp = b; at = System.currentTimeMillis(); } }

    private final Activity act;
    private final List<Paper> papers = new ArrayList<>();
    private Dialog dlg;
    private LinearLayout list;

    public Simulator(Activity act) { this.act = act; }

    public void add(String printer, String title, int copies, Bitmap bmp) {
        act.runOnUiThread(() -> {
            Paper p = new Paper(printer, title, copies, bmp);
            papers.add(0, p);
            while (papers.size() > 40) papers.remove(papers.size() - 1);
            show();
            if (list != null) list.addView(card(p), 0);
        });
    }

    public void show() {
        act.runOnUiThread(() -> {
            if (dlg != null && dlg.isShowing()) return;
            dlg = new Dialog(act, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            dlg.requestWindowFeature(Window.FEATURE_NO_TITLE);
            LinearLayout root = new LinearLayout(act);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.parseColor("#0F172A"));
            root.setLayoutDirection(android.view.View.LAYOUT_DIRECTION_RTL);
            LinearLayout bar = new LinearLayout(act);
            bar.setPadding(dp(14), dp(10), dp(14), dp(10));
            bar.setGravity(Gravity.CENTER_VERTICAL);
            TextView title = new TextView(act);
            title.setText("🧪 محاكي الطابعات");
            title.setTextColor(Color.WHITE); title.setTextSize(18);
            bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            Button clear = new Button(act); clear.setText("🗑️ مسح");
            clear.setOnClickListener(v -> { papers.clear(); if (list != null) list.removeAllViews(); });
            Button close = new Button(act); close.setText("✕ إغلاق");
            close.setOnClickListener(v -> dlg.dismiss());
            bar.addView(clear); bar.addView(close);
            root.addView(bar);
            ScrollView sv = new ScrollView(act);
            list = new LinearLayout(act);
            list.setOrientation(LinearLayout.VERTICAL);
            list.setGravity(Gravity.CENTER_HORIZONTAL);
            list.setPadding(dp(12), dp(8), dp(12), dp(24));
            if (papers.isEmpty()) {
                TextView empty = new TextView(act);
                empty.setText("بانتظار أول طباعة… سوّي طلب من الكاشير أو اضغط «🧾 طلب تجريبي».");
                empty.setTextColor(Color.parseColor("#93A4BD")); empty.setGravity(Gravity.CENTER); empty.setPadding(0, dp(60), 0, 0);
                list.addView(empty);
            }
            for (Paper p : papers) list.addView(card(p));
            sv.addView(list);
            root.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            dlg.setContentView(root);
            if (dlg.getWindow() != null) dlg.getWindow().setBackgroundDrawable(new ColorDrawable(Color.parseColor("#0F172A")));
            dlg.show();
        });
    }

    private LinearLayout card(Paper p) {
        if (list != null && list.getChildCount() == 1 && list.getChildAt(0) instanceof TextView) list.removeAllViews();
        LinearLayout c = new LinearLayout(act);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(0, dp(10), 0, dp(10));
        TextView cap = new TextView(act);
        String t = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date(p.at));
        cap.setText("🖨️ " + p.printer.replace(PrintEngine.VPRE, "") + "  •  " + p.title + "  •  " + t + (p.copies > 1 ? "  •  × " + p.copies + " نسخ" : ""));
        cap.setTextColor(Color.parseColor("#E5EDF7")); cap.setTextSize(13);
        c.addView(cap);
        ImageView img = new ImageView(act);
        img.setImageBitmap(p.bmp);
        img.setAdjustViewBounds(true);
        img.setBackgroundColor(Color.WHITE);
        int w = Math.min(dp(360), act.getResources().getDisplayMetrics().widthPixels - dp(24));
        c.addView(img, new LinearLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT));
        return c;
    }

    private int dp(int v) { return Math.round(v * act.getResources().getDisplayMetrics().density); }
}
