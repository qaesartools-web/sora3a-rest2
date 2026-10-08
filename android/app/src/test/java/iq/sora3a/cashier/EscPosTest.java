package iq.sora3a.cashier;

import static org.junit.Assert.*;
import org.junit.Test;

public class EscPosTest {
    @Test public void dotsForPaperWidth() {
        assertEquals(576, EscPos.dotsFor(80));
        assertEquals(384, EscPos.dotsFor(58));
    }

    @Test public void thresholdTreatsTransparentAsWhite() {
        int[] px = {0xFF000000, 0xFFFFFFFF, 0x00000000, 0xFF808080};
        boolean[] b = EscPos.threshold(px, 4, 1, 160);
        assertArrayEquals(new boolean[]{true, false, false, true}, b);
    }

    @Test public void rasterPacksBitsMsbFirstWithHeader() {
        // 10 نقاط عرض (يحتاج بايتين بالسطر)، سطرين
        boolean[] b = new boolean[20];
        b[0] = true; b[9] = true;        // السطر الأول: أول نقطة + العاشرة
        b[10 + 7] = true;                // السطر الثاني: الثامنة
        byte[] r = EscPos.raster(b, 10, 2);
        byte[] head = {0x1D, 0x76, 0x30, 0x00, 2, 0, 2, 0};
        for (int i = 0; i < head.length; i++) assertEquals("header " + i, head[i], r[i]);
        assertEquals((byte) 0x80, r[8]);  assertEquals((byte) 0x40, r[9]);
        assertEquals((byte) 0x01, r[10]); assertEquals((byte) 0x00, r[11]);
        assertEquals(12, r.length);
    }

    @Test public void tallImagesAreSplitIntoBands() {
        boolean[] b = new boolean[8 * 300];
        byte[] r = EscPos.raster(b, 8, 300);
        int bands = 0;
        for (int i = 0; i + 3 < r.length; i++) if (r[i] == 0x1D && r[i + 1] == 0x76 && r[i + 2] == 0x30) bands++;
        assertEquals(3, bands);                    // 128 + 128 + 44
        assertEquals(3 * 8 + 300, r.length);
    }

    @Test public void jobRepeatsInitImageFeedCutPerCopy() {
        byte[] j = EscPos.job(new boolean[8], 8, 1, 2);
        int inits = 0, cuts = 0;
        for (int i = 0; i + 1 < j.length; i++) {
            if (j[i] == 0x1B && j[i + 1] == 0x40) inits++;
            if (i + 3 < j.length && j[i] == 0x1D && j[i + 1] == 0x56 && j[i + 2] == 0x42) cuts++;
        }
        assertEquals(2, inits); assertEquals(2, cuts);
        assertEquals(0x1B, j[0]); assertEquals(0x40, j[1]);
    }
}
