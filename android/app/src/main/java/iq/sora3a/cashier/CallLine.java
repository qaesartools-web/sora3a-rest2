package iq.sora3a.cashier;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

// خط المطعم: أول ما يرن التلفون (شريحة أو واتساب) يوصل رقم المتصل لكاشير المطعم — بدل MacroDroid
public final class CallLine {
    private CallLine() {}

    public static final String URL_CALLS = "https://firestore.googleapis.com/v1/projects/sora3a-system/databases/(default)/documents/incomingCalls?key=AIzaSyAwlFrbv-c6G0_K0-s0P1m1o_qD95aGGyQ";
    public static final String[] WA_PACKAGES = {"com.whatsapp", "com.whatsapp.w4b"};

    public static final class Config {
        public final String token, restaurantId, line, label; public final boolean sim, wa;
        public Config(String token, String restaurantId, String line, String label, boolean sim, boolean wa) {
            this.token = token; this.restaurantId = restaurantId; this.line = line; this.label = label; this.sim = sim; this.wa = wa;
        }
        public boolean valid() { return token != null && token.length() >= 24 && restaurantId != null && !restaurantId.isEmpty() && line != null && !line.isEmpty(); }
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
