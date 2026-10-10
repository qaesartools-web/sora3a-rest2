package iq.sora3a.cashier;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// خط المطعم: أول ما يرن التلفون (شريحة أو واتساب) يوصل رقم المتصل لكاشير المطعم — بدل MacroDroid
public final class CallLine {
    private CallLine() {}

    public static final String URL_CALLS = "https://firestore.googleapis.com/v1/projects/sora3a-system/databases/(default)/documents/incomingCalls?key=AIzaSyAwlFrbv-c6G0_K0-s0P1m1o_qD95aGGyQ";
    public static final String[] WA_PACKAGES = {"com.whatsapp", "com.whatsapp.w4b"};

    // رقم مربوط على هذا التلفون (التلفون يكدر يحمل أكثر من رقم: شريحتين، واتساب، واتساب أعمال)
    //  sim: مكالمات الشريحة — slot/subId تحدد أي شريحة (-1 = أي شريحة)
    //  wa: مكالمات الواتساب — pkg يحدد أي تطبيق (com.whatsapp أو com.whatsapp.w4b؛ فارغ = أي واتساب)
    public static final class Config {
        public final String token, restaurantId, line, label, pkg; public final boolean sim, wa; public final int slot, subId;
        public Config(String token, String restaurantId, String line, String label, boolean sim, boolean wa) {
            this(token, restaurantId, line, label, sim, wa, -1, -1, "");
        }
        public Config(String token, String restaurantId, String line, String label, boolean sim, boolean wa, int slot, int subId, String pkg) {
            this.token = token; this.restaurantId = restaurantId; this.line = line; this.label = label; this.sim = sim; this.wa = wa;
            this.slot = slot; this.subId = subId; this.pkg = pkg == null ? "" : pkg;
        }
        public boolean valid() { return token != null && token.length() >= 24 && restaurantId != null && !restaurantId.isEmpty() && line != null && !line.isEmpty(); }
        boolean anySim() { return slot < 0 && subId < 0; }
        // نفس المصدر (ما يصير رقمين على نفس الشريحة أو نفس تطبيق الواتساب)
        public boolean sameSource(Config o) {
            if (sim && o.sim) { if (anySim() || o.anySim() || (subId >= 0 && subId == o.subId) || (slot >= 0 && slot == o.slot)) return true; }
            if (wa && o.wa) { if (pkg.isEmpty() || o.pkg.isEmpty() || pkg.equals(o.pkg)) return true; }
            return false;
        }
    }

    // مكالمة شريحة رنّت (subId/slot من الأندرويد، -1 إذا الجهاز ما يكول): أي رقم يستلمها؟
    //  الاشتراك ← الخانة ← «أي شريحة»؛ وإذا الجهاز ما يميّز الشريحة: أول رقم شريحة.
    //  شريحة مو مربوطة (مثلاً شريحة شخصية بنفس التلفون) ← null: ما توصل للكاشير
    public static Config pickSim(List<Config> list, int subId, int slot) {
        Config first = null;
        for (Config c : list) if (c.sim) { if (first == null) first = c; if (subId >= 0 && c.subId == subId) return c; }
        for (Config c : list) if (c.sim && slot >= 0 && c.slot == slot) return c;
        for (Config c : list) if (c.sim && c.anySim()) return c;
        return subId < 0 && slot < 0 ? first : null;
    }

    // مكالمة واتساب: الرقم المربوط بنفس التطبيق، أو «أي واتساب»
    public static Config pickWa(List<Config> list, String pkg) {
        for (Config c : list) if (c.wa && !c.pkg.isEmpty() && c.pkg.equals(pkg)) return c;
        for (Config c : list) if (c.wa && c.pkg.isEmpty()) return c;
        return null;
    }

    // نفس الحقول اللي تقبلها قواعد الحماية (incomingCalls)؛ خط الواتساب اسمه يحتوي «واتساب»
    public static String body(Config c, String number, boolean whatsapp) {
        String ln = whatsapp ? "واتساب " + c.line : c.line;
        String num = clean(number);
        return "{\"fields\":{\"token\":{\"stringValue\":" + q(c.token) + "},\"restaurantId\":{\"stringValue\":" + q(c.restaurantId)
            + "},\"line\":{\"stringValue\":" + q(ln) + "},\"number\":{\"stringValue\":" + q(num) + "},\"status\":{\"stringValue\":\"ringing\"}}}";
    }

    static String clean(String n) {
        String s = n == null ? "" : n.trim().replaceAll("[\\u200e\\u200f\\u202a-\\u202e]", "");
        if (s.length() > 24) s = s.substring(0, 24).trim();
        while (s.length() < 3) s = s + " ";
        return s;
    }

    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }

    // نفس المتصل خلال 45 ثانية = نفس المكالمة (الواتساب يحدّث الإشعار وهو يرن، والشريحة ترسل الحالة مرتين)
    private static final Map<String, Long> recent = new HashMap<>();
    public static synchronized boolean firstRing(String key, long now) {
        recent.entrySet().removeIf(e -> now - e.getValue() > 45_000);
        if (recent.containsKey(key)) return false;
        recent.put(key, now);
        return true;
    }

    // إشعار واتساب ← اسم/رقم المتصل إذا كان مكالمة واردة، وإلا null
    public static String whatsappCaller(String pkg, String category, String title, String text) {
        boolean wa = false;
        for (String p : WA_PACKAGES) wa |= p.equals(pkg);
        if (!wa || title == null || title.trim().isEmpty()) return null;
        String t = text == null ? "" : text;
        boolean call = "call".equals(category) || t.matches("(?is).*(incoming (voice|video) call|مكالمة (صوتية|فيديو)? ?واردة|مكالمة واردة).*");
        boolean missedOrOngoing = t.matches("(?is).*(missed|فائتة|ongoing|جارية|calling|جارٍ الاتصال).*");
        return call && !missedOrOngoing ? title.trim() : null;
    }

    public static int post(String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(URL_CALLS).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(8000); c.setReadTimeout(8000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try (OutputStream o = c.getOutputStream()) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
        int code = c.getResponseCode();
        c.disconnect();
        return code;
    }
}
