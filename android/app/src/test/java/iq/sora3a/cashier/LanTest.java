package iq.sora3a.cashier;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

// شبكة المطعم: نفس بصمات برنامج الحاسبة (desktop/test/lan.test.js)، والمصافحة والرسائل بين المركز والشاشة
public class LanTest {
    static String rep(char c, int n) { char[] a = new char[n]; java.util.Arrays.fill(a, c); return new String(a); }
    static final String KEY = rep('a', 64);

    @Test public void hmacVectorsMatchTheDesktopProgram() {
        assertEquals("f0e61934b7265f7e74acda9d3a391c5ea96963a03e9a14f03df95d0811a8cb71", LanProto.hmac(rep('k', 64), "c|sn|cn|R1|kitchen|D1"));
        assertEquals("0976c10eed9d2c5f19118e3aa0923d5c98d5214ada829d5f45fcc03380535431",
            LanProto.macEvent("0123456789abcdef0123456789abcdef", "R1", "D1", "id1", 1700000000000L, "{\"t\":\"call\"}"));
    }

    @Test public void signedEventsAreCheckedAndCountedOnce() throws Exception {
        LanProto.Cfg line = new LanProto.Cfg("R1", KEY, "line-1", "خط"), hub = new LanProto.Cfg("R1", KEY, "hub-1", "كاشير");
        JSONObject ev = new JSONObject(LanProto.signEvent(line, "{\"t\":\"call\",\"id\":\"c1\"}"));
        HashMap<String, Long> seen = new HashMap<>();
        String[] r = LanProto.checkEvent(hub, ev, seen, System.currentTimeMillis());
        assertNotNull(r);
        assertEquals("line-1", r[0]);
        assertEquals("c1", new JSONObject(r[1]).getString("id"));
        assertNull("replay", LanProto.checkEvent(hub, ev, seen, System.currentTimeMillis()));
        JSONObject forged = new JSONObject(LanProto.signEvent(new LanProto.Cfg("R1", rep('b', 64), "x", ""), "{\"t\":\"call\"}"));
        assertNull("wrong key", LanProto.checkEvent(hub, forged, seen, System.currentTimeMillis()));
        JSONObject old = new JSONObject(LanProto.signEvent(line, "{\"t\":\"call\",\"id\":\"c2\"}"));
        assertNull("too old", LanProto.checkEvent(hub, old, seen, System.currentTimeMillis() + 11 * 60_000));
        assertNull("other restaurant", LanProto.checkEvent(new LanProto.Cfg("R2", KEY, "h", ""), ev, new HashMap<>(), System.currentTimeMillis()));
    }

    @Test public void cfgNeedsRestaurantKeyAndDevice() {
        assertTrue(new LanProto.Cfg("R1", KEY, "d", "").valid());
        assertFalse(new LanProto.Cfg("", KEY, "d", "").valid());
        assertFalse(new LanProto.Cfg("R1", "short", "d", "").valid());
        assertFalse(new LanProto.Cfg("R1", KEY, "", "").valid());
    }

    static JSONObject waitFor(List<JSONObject> evs, String t, int n) throws Exception {
        long end = System.currentTimeMillis() + 6000;
        while (System.currentTimeMillis() < end) {
            int c = 0;
            for (JSONObject e : evs) if (t.equals(e.optString("t")) && ++c == n) return e;
            Thread.sleep(50);
        }
        throw new AssertionError("no " + t + " #" + n + " in " + evs);
    }

    @Test public void kitchenFindsTheHubAuthenticatesAndTalksBothWays() throws Exception {
        int u = 42000 + (int) (Math.random() * 8000);
        List<JSONObject> hubEv = new CopyOnWriteArrayList<>(), kEv = new CopyOnWriteArrayList<>();
        LanHub hub = new LanHub(hubEv::add, u, 0, "127.0.0.1", Collections.singletonList("127.0.0.1"));
        JSONObject st = hub.start(new LanProto.Cfg("R1", KEY, "hub-1", "كاشير 1"));
        assertTrue(st.getBoolean("on"));
        LanClient k = new LanClient("kitchen", kEv::add, LanClient.PLAIN, null, u, Collections.singletonList("127.0.0.1"), false);
        k.start(new LanProto.Cfg("R1", KEY, "kitchen-1", "المطبخ"));
        JSONObject j = waitFor(hubEv, "join", 1);
        assertEquals("kitchen", j.getString("role"));
        assertEquals("المطبخ", j.getString("name"));
        JSONObject kj = waitFor(kEv, "join", 1);
        assertEquals("hub-1", kj.getString("id"));
        assertEquals("كاشير 1", kj.getString("name"));
        hub.send("*", "{\"t\":\"state\",\"orders\":[{\"id\":\"o1\"}]}");
        assertEquals("o1", waitFor(kEv, "msg", 1).getJSONObject("d").getJSONArray("orders").getJSONObject(0).getString("id"));
        k.send("hub-1", "{\"t\":\"act\",\"id\":\"o1\",\"op\":\"ready\"}");
        JSONObject m = waitFor(hubEv, "msg", 1);
        assertEquals(j.getString("id"), m.getString("id"));
        assertEquals("ready", m.getJSONObject("d").getString("op"));
        // الخط: حدث موقّع بالبث يوصل للمركز
        LanClient line = new LanClient("line", e -> {}, LanClient.PLAIN, null, u, Collections.singletonList("127.0.0.1"), false);
        line.start(new LanProto.Cfg("R1", KEY, "line-1", "خط"));
        Thread.sleep(300);
        line.broadcast("{\"t\":\"call\",\"id\":\"c1\",\"number\":\"07701234567\"}");
        JSONObject ev = waitFor(hubEv, "ev", 1);
        assertEquals("07701234567", ev.getJSONObject("d").getString("number"));
        assertTrue(line.awaitHub(4000));
        k.stop();
        assertEquals("kitchen", waitFor(hubEv, "leave", 1).getString("role"));
        line.stop(); hub.stop();
    }

    @Test public void wrongKeyNeverGetsIn() throws Exception {
        int u = 42000 + (int) (Math.random() * 8000);
        List<JSONObject> hubEv = new CopyOnWriteArrayList<>(), kEv = new CopyOnWriteArrayList<>();
        LanHub hub = new LanHub(hubEv::add, u, 0, "127.0.0.1", Collections.singletonList("127.0.0.1"));
        hub.start(new LanProto.Cfg("R1", KEY, "hub-1", "كاشير"));
        LanClient k = new LanClient("kitchen", kEv::add, LanClient.PLAIN, null, u, Collections.singletonList("127.0.0.1"), false);
        k.start(new LanProto.Cfg("R1", rep('b', 64), "kitchen-1", ""));
        Thread.sleep(2000);
        for (JSONObject e : hubEv) assertNotEquals("join", e.optString("t"));
        for (JSONObject e : kEv) assertNotEquals("join", e.optString("t"));
        assertFalse(k.anyOn());
        k.stop(); hub.stop();
    }
}
