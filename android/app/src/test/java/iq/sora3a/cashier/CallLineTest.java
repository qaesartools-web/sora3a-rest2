package iq.sora3a.cashier;

import static org.junit.Assert.*;
import org.junit.Test;

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
}
