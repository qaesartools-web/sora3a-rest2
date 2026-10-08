package iq.sora3a.cashier;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

// محرك الطباعة بتطبيق الكاشير (نفس منطق برنامج الويندوز):
// طابور لكل طابعة + إعادة محاولة + طباعة بديلة على الرئيسية + سجل + طابعات وهمية لوضع التجربة
public class PrintEngine {
    public static final class Printer {
        public final String name; public final String kind; public final boolean ok; public final String statusText; public final boolean isDefault;
        public Printer(String name, String kind, boolean ok, String statusText, boolean isDefault) {
            this.name = name; this.kind = kind; this.ok = ok; this.statusText = statusText; this.isDefault = isDefault;
        }
    }
    public static final class Page {
        public final boolean[] black; public final int width; public final int height; public final Object image;
        public Page(boolean[] black, int width, int height, Object image) { this.black = black; this.width = width; this.height = height; this.image = image; }
    }
    public interface Backend {
        List<Printer> list();
        void send(String printer, byte[] data) throws Exception;
    }
    public interface Renderer { Page render(String html, int widthMm) throws Exception; }
    public interface PaperSink { void paper(String printer, String title, int copies, int widthMm, Page page); }
    public interface TestMode { boolean on(); }

    public static final String VPRE = "🧪 تجريبية — ";
    public static final String[][] VIRTUAL = {
        {VPRE + "الكاشير", "ok"}, {VPRE + "مطبخ 1", "ok"}, {VPRE + "مطبخ 2", "ok"}, {VPRE + "مطبخ 3", "ok"},
        {VPRE + "مطفية", "مطفية أو مفصولة"}, {VPRE + "خلص الورق", "خلص الورق"},
    };
    public static boolean isVirtual(String n) { for (String[] v : VIRTUAL) if (v[0].equals(n)) return true; return false; }

    public static final class Job {
        public final int id; public final long at; public final String title; public final String printer; public final int copies;
        public Boolean ok = null; public String error = ""; public String fallback = "";
        final String html; final int widthMm; final String fallbackTo;
        Job(int id, String title, String printer, int copies, String html, int widthMm, String fallbackTo) {
            this.id = id; this.at = System.currentTimeMillis(); this.title = title; this.printer = printer; this.copies = copies;
            this.html = html; this.widthMm = widthMm; this.fallbackTo = fallbackTo;
        }
    }
    public static final class Result {
        public final boolean ok, fallback; public final String error, printer; public final int id;
        Result(boolean ok, boolean fallback, String error, String printer, int id) { this.ok = ok; this.fallback = fallback; this.error = error; this.printer = printer; this.id = id; }
    }

    private final Backend backend; private final Renderer renderer; private final PaperSink sink; private final TestMode test;
    private final Map<String, ExecutorService> queues = new HashMap<>();
    private final LinkedList<Job> jobs = new LinkedList<>();
    private int seq = 0;
    private final int retries;

    public PrintEngine(Backend backend, Renderer renderer, PaperSink sink, TestMode test, int retries) {
        this.backend = backend; this.renderer = renderer; this.sink = sink; this.test = test; this.retries = retries;
    }

    public List<Printer> printers() {
        List<Printer> all = new ArrayList<>();
        try { all.addAll(backend.list()); } catch (Exception ignored) {}
        if (test.on()) for (int i = 0; i < VIRTUAL.length; i++) {
            boolean ok = "ok".equals(VIRTUAL[i][1]);
            all.add(new Printer(VIRTUAL[i][0], "virtual", ok, ok ? "جاهزة" : VIRTUAL[i][1], i == 0 && all.isEmpty()));
        }
        return all;
    }

    private Printer find(String name) { for (Printer p : printers()) if (p.name.equals(name)) return p; return null; }
    private String defaultName() {
        List<Printer> l = printers();
        for (Printer p : l) if (p.isDefault) return p.name;
        return l.isEmpty() ? "" : l.get(0).name;
    }

    private synchronized ExecutorService queue(String printer) {
        ExecutorService q = queues.get(printer);
        if (q == null) { q = Executors.newSingleThreadExecutor(); queues.put(printer, q); }
        return q;
    }

    // ترجع null إذا نجحت، وإلا سبب الفشل
    private String attempt(String printer, String html, int widthMm, int copies, String title) {
        String err = null;
        for (int i = 0; i <= retries; i++) {
            try {
                Future<?> f = queue(printer).submit(() -> {
                    Page pg = renderer.render(html, widthMm);
                    if (isVirtual(printer)) { sink.paper(printer, title, copies, widthMm, pg); return null; }
                    backend.send(printer, EscPos.job(pg.black, pg.width, pg.height, copies));
                    return null;
                });
                f.get();
                return null;
            } catch (Exception e) {
                Throwable c = e.getCause() != null ? e.getCause() : e;
                err = c.getMessage() != null ? c.getMessage() : c.toString();
            }
        }
        return err;
    }

    public Result print(String html, String printer, int widthMm, int copies, String title, String fallback) {
        widthMm = widthMm >= 40 && widthMm <= 120 ? widthMm : 80;
        copies = Math.max(1, Math.min(5, copies));
        if (title == null || title.isEmpty()) title = "طباعة";
        if (printer == null || printer.isEmpty()) printer = defaultName();
        if (fallback != null && fallback.isEmpty()) fallback = defaultName();
        Job job;
        synchronized (this) {
            job = new Job(++seq, title, printer.isEmpty() ? "الطابعة الافتراضية" : printer, copies, html.length() < 400000 ? html : "", widthMm, fallback);
            jobs.addFirst(job);
            while (jobs.size() > 50) jobs.removeLast();
        }
        String err;
        if (printer.isEmpty()) err = "ماكو طابعة — أضف طابعة أولاً";
        else {
            Printer p = find(printer);
            if (p == null) err = "الطابعة مو موجودة بهالجهاز";
            else if (!p.ok) err = "الطابعة " + p.statusText;
            else err = attempt(printer, html, widthMm, copies, title);
        }
        if (err == null) { job.ok = true; return new Result(true, false, "", job.printer, job.id); }
        job.ok = false; job.error = err;
        if (fallback != null && !fallback.isEmpty() && !fallback.equals(printer)) {
            String note = "<div style=\"font-family:Arial,sans-serif;direction:rtl;text-align:center;border:2px solid #000;margin:4px;padding:4px;font-size:14px;font-weight:900\">⚠️ طابعة «"
                + escape(printer) + "» ما اشتغلت</div>";
            String html2 = html.matches("(?is).*<body[^>]*>.*") ? html.replaceFirst("(?i)(<body[^>]*>)", "$1" + java.util.regex.Matcher.quoteReplacement(note)) : note + html;
            Printer fp = find(fallback);
            String err2 = fp == null ? "الرئيسية مو موجودة" : !fp.ok ? "الرئيسية " + fp.statusText : attempt(fallback, html2, widthMm, copies, title);
            if (err2 == null) { job.fallback = fallback; return new Result(false, true, err, fallback, job.id); }
            job.error += " — والرئيسية: " + err2;
        }
        return new Result(false, false, job.error, job.printer, job.id);
    }

    public synchronized List<Job> jobs() { return new ArrayList<>(jobs); }

    public Result reprint(int id) {
        Job j = null;
        synchronized (this) { for (Job x : jobs) if (x.id == id) { j = x; break; } }
        if (j == null || j.html.isEmpty()) return new Result(false, false, "ما لكينا هالطباعة", "", id);
        String t = j.title.startsWith("🔁 ") ? j.title : "🔁 " + j.title;
        return print(j.html, j.printer.equals("الطابعة الافتراضية") ? "" : j.printer, j.widthMm, j.copies, t, j.fallbackTo);
    }

    static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
