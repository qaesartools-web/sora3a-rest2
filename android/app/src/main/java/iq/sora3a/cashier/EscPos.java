package iq.sora3a.cashier;

import java.io.ByteArrayOutputStream;

// أوامر طابعات الفواتير الحرارية (ESC/POS): الورقة تنطبع كصورة حتى العربي يطلع صحيح بأي طابعة
public final class EscPos {
    private EscPos() {}

    public static final byte[] INIT = {0x1B, 0x40};
    public static final byte[] CUT = {0x1D, 0x56, 0x42, 0x00};      // قص جزئي بعد تغذية بسيطة
    public static byte[] feed(int lines) { return new byte[]{0x1B, 0x64, (byte) Math.max(0, Math.min(255, lines))}; }

    // عدد النقاط بعرض الورقة (203 نقطة بالإنج): 80 ملم ← 576، 58 ملم ← 384
    public static int dotsFor(int widthMm) { return widthMm <= 60 ? 384 : 576; }

    // صورة (ARGB) ← أبيض/أسود حسب الإضاءة
    public static boolean[] threshold(int[] argb, int width, int height, int cut) {
        boolean[] black = new boolean[width * height];
        for (int i = 0; i < black.length; i++) {
            int c = argb[i], a = (c >>> 24) & 0xFF, r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
            int lum = (r * 299 + g * 587 + b * 114) / 1000;
            lum = 255 - ((255 - lum) * a / 255); // الشفاف = أبيض
            black[i] = lum < cut;
        }
        return black;
    }

    // GS v 0 بشرائح (بعض الطابعات ذاكرتها صغيرة)
    public static byte[] raster(boolean[] black, int width, int height) {
        int bytesW = (width + 7) / 8;
        ByteArrayOutputStream out = new ByteArrayOutputStream(bytesW * height + 64);
        final int band = 128;
        for (int y0 = 0; y0 < height; y0 += band) {
            int h = Math.min(band, height - y0);
            out.write(0x1D); out.write(0x76); out.write(0x30); out.write(0x00);
            out.write(bytesW & 0xFF); out.write((bytesW >> 8) & 0xFF);
            out.write(h & 0xFF); out.write((h >> 8) & 0xFF);
            for (int y = y0; y < y0 + h; y++) {
                for (int bx = 0; bx < bytesW; bx++) {
                    int v = 0;
                    for (int bit = 0; bit < 8; bit++) {
                        int x = bx * 8 + bit;
                        if (x < width && black[y * width + x]) v |= 0x80 >> bit;
                    }
                    out.write(v);
                }
            }
        }
        return out.toByteArray();
    }

    // ورقة كاملة: تهيئة + الصورة + تغذية + قص، مكررة بعدد النسخ
    public static byte[] job(boolean[] black, int width, int height, int copies) {
        byte[] img = raster(black, width, height);
        ByteArrayOutputStream out = new ByteArrayOutputStream(img.length * Math.max(1, copies) + 32);
        for (int c = 0; c < Math.max(1, copies); c++) {
            out.write(INIT, 0, INIT.length);
            out.write(img, 0, img.length);
            byte[] f = feed(4);
            out.write(f, 0, f.length);
            out.write(CUT, 0, CUT.length);
        }
        return out.toByteArray();
    }
}
