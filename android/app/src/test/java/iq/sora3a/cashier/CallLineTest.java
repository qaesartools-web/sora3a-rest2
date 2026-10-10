package iq.sora3a.cashier;

import static org.junit.Assert.*;
import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class CallLineTest {
    static final CallLine.Config C = new CallLine.Config("T0123456789abcdefghijKLMN", "RM", "2", "0770 111 2222", true, true);

    @Test public void simCallBodyMatchesFirestoreRules() {
        String b = CallLine.body(C, "07701234567", false);
        assertEquals("{\"fields\":{\"token\":{\"stringValue\":\"T0123456789abcdefghijKLMN\"},\"restaurantId\":{\"stringValue\":\"RM\"},"
            + "\"line\":{\"stringValue\":\"2\"},\"number\":{\"stringValue\":\"07701234567\"},\"status\":{\"stringValue\":\"ringing\"}}}", b);
    }

    @Test public void whatsappLineIsNamedSoTheWhatsappServiceApplies() {
        assertTrue(CallLine.body(C, "أبو حسين", true).contains("\"line\":{\"stringValue\":\"واتساب 2\"}"));
    }

    @Test public void numbersAreCleanedTruncatedAndEscaped() {
        assertTrue(CallLine.body(C, "‎+964 770 123 4567‏", false).contains("\"+964 770 123 4567\""));
        assertTrue(CallLine.body(C, "اسم طويل جداً جداً جداً جداً جداً", true).contains("\"اسم طويل جداً جداً جداً\""));  // 24 حرف بدون فراغ بالآخر
        assertTrue(CallLine.body(C, "a\"b", true).contains("\"a\\\"b\""));
        assertTrue(CallLine.body(C, "7", false).contains("\"7  \""));   // القواعد تطلب 3 أحرف على الأقل
    }

    @Test public void sameCallerWithin45sCountsOnce() {
        assertTrue(CallLine.firstRing("wa:x", 1_000_000));
        assertFalse(CallLine.firstRing("wa:x", 1_010_000));
        assertTrue(CallLine.firstRing("wa:y", 1_010_000));
        assertTrue(CallLine.firstRing("wa:x", 1_050_001));
    }

    @Test public void whatsappIncomingCallsAreRecognised() {
        assertEquals("أبو حسين", CallLine.whatsappCaller("com.whatsapp", "call", "أبو حسين", "مكالمة صوتية واردة"));
        assertEquals("+964 770 123 4567", CallLine.whatsappCaller("com.whatsapp.w4b", null, "+964 770 123 4567", "Incoming voice call"));
        assertEquals("Ali", CallLine.whatsappCaller("com.whatsapp", null, "Ali", "Incoming video call"));
        assertNull(CallLine.whatsappCaller("com.whatsapp", "msg", "Ali", "مرحبا شلونك"));          // رسالة
        assertNull(CallLine.whatsappCaller("com.whatsapp", "call", "Ali", "Missed voice call"));    // فائتة
        assertNull(CallLine.whatsappCaller("com.whatsapp", "call", "Ali", "Ongoing voice call"));   // جارية
        assertNull(CallLine.whatsappCaller("com.viber.voip", "call", "Ali", "Incoming call"));      // مو واتساب
        assertFalse(new CallLine.Config("short", "RM", "1", "", true, true).valid());
        assertTrue(C.valid());
    }

    // تلفون بيه أكثر من رقم: شريحة 1، شريحة 2، واتساب، واتساب أعمال — كل واحد لخطه
    static CallLine.Config sim(String t, int slot, int sub) { return new CallLine.Config(t + "0123456789abcdefghijKLMN", "RM", t, "07" + t, true, false, slot, sub, ""); }
    static CallLine.Config wa(String t, String pkg) { return new CallLine.Config(t + "0123456789abcdefghijKLMN", "RM", t, "07" + t, false, true, -1, -1, pkg); }

    @Test public void dualSimCallGoesToTheRingingSimsNumber() {
        List<CallLine.Config> l = Arrays.asList(sim("1", 0, 11), sim("2", 1, 12), wa("3", "com.whatsapp"));
        assertEquals("1", CallLine.pickSim(l, 11, 0).line);
        assertEquals("2", CallLine.pickSim(l, 12, 1).line);
        assertEquals("2", CallLine.pickSim(l, 99, 1).line);    // الشريحة انشالت ورجعت (اشتراك جديد) ← بالخانة
        assertEquals("2", CallLine.pickSim(l, 12, -1).line);   // الخانة مو معروفة ← بالاشتراك
        assertEquals("1", CallLine.pickSim(l, -1, -1).line);   // الجهاز ما يكول أي شريحة ← أول رقم شريحة
    }

    @Test public void unlinkedSimDoesNotReachTheCashier() {
        List<CallLine.Config> l = Arrays.asList(sim("1", 0, 11), wa("3", ""));
        assertNull(CallLine.pickSim(l, 12, 1));                // شريحة شخصية بنفس التلفون
        assertNull(CallLine.pickSim(Arrays.asList(wa("3", "")), -1, -1));   // واتساب بس
    }

    @Test public void legacySingleNumberTakesEverything() {
        List<CallLine.Config> l = Arrays.asList(C);              // النسخة القديمة: رقم واحد للشريحة والواتساب
        assertSame(C, CallLine.pickSim(l, 12, 1));
        assertSame(C, CallLine.pickSim(l, -1, -1));
        assertSame(C, CallLine.pickWa(l, "com.whatsapp.w4b"));
    }

    @Test public void whatsappAndBusinessCanBeDifferentNumbers() {
        List<CallLine.Config> l = Arrays.asList(wa("3", "com.whatsapp"), wa("4", "com.whatsapp.w4b"));
        assertEquals("3", CallLine.pickWa(l, "com.whatsapp").line);
        assertEquals("4", CallLine.pickWa(l, "com.whatsapp.w4b").line);
        assertNull(CallLine.pickWa(Arrays.asList(wa("3", "com.whatsapp")), "com.whatsapp.w4b"));   // أعمال مو مربوط
        assertEquals("5", CallLine.pickWa(Arrays.asList(wa("3", "com.whatsapp"), wa("5", "")), "com.whatsapp.w4b").line);   // «أي واتساب»
    }

    @Test public void oneNumberPerSource() {
        assertTrue(sim("1", 0, 11).sameSource(sim("9", 0, 77)));
        assertFalse(sim("1", 0, 11).sameSource(sim("2", 1, 12)));
        assertTrue(sim("1", -1, -1).sameSource(sim("2", 1, 12)));            // «أي شريحة» تغطي الكل
        assertTrue(wa("3", "com.whatsapp").sameSource(wa("9", "com.whatsapp")));
        assertFalse(wa("3", "com.whatsapp").sameSource(wa("4", "com.whatsapp.w4b")));
        assertFalse(sim("1", 0, 11).sameSource(wa("3", "com.whatsapp")));
    }
}
