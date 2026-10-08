package iq.sora3a.cashier;

import static org.junit.Assert.*;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

public class PrintEngineTest {
    static PrintEngine.Page page() { return new PrintEngine.Page(new boolean[8 * 4], 8, 4, null); }

    static class Rig {
        final List<String> sent = Collections.synchronizedList(new ArrayList<>());
        final List<String> papers = Collections.synchronizedList(new ArrayList<>());
        final List<String> htmls = Collections.synchronizedList(new ArrayList<>());
        List<String> failOn = new ArrayList<>();
        int flaky = 0;
        boolean test = false;
        final List<PrintEngine.Printer> list = new ArrayList<>();
        final PrintEngine e;
        Rig() {
            list.add(new PrintEngine.Printer("LAN 192.168.1.50", "lan", true, "جاهزة", true));
            list.add(new PrintEngine.Printer("Kitchen BT", "bt", true, "جاهزة", false));
            list.add(new PrintEngine.Printer("Grill LAN", "lan", false, "ما ترد على الشبكة", false));
            e = new PrintEngine(new PrintEngine.Backend() {
                public List<PrintEngine.Printer> list() { return list; }
                public void send(String p, byte[] d) throws Exception {
                    if (failOn.contains(p)) throw new Exception("boom");
                    if (flaky > 0) { flaky--; throw new Exception("flaky"); }
                    sent.add(p);
                }
            }, (html, w) -> { htmls.add(html); return page(); }, (p, t, c, w, pg) -> papers.add(p + "|" + t + "|" + c), () -> test, 1);
        }
    }

    @Test public void printsToNamedPrinter() {
        Rig r = new Rig();
        PrintEngine.Result res = r.e.print("<html><body>x</body></html>", "Kitchen BT", 80, 2, "تذكرة", null);
        assertTrue(res.ok); assertEquals(List.of("Kitchen BT"), r.sent);
    }

    @Test public void emptyPrinterMeansDefault() {
        Rig r = new Rig();
        assertTrue(r.e.print("x", "", 80, 1, "فاتورة", null).ok);
        assertEquals(List.of("LAN 192.168.1.50"), r.sent);
    }

    @Test public void flakyFailureRetriedOnce() {
        Rig r = new Rig(); r.flaky = 1;
        assertTrue(r.e.print("x", "Kitchen BT", 80, 1, "t", null).ok);
        assertEquals(1, r.sent.size());
    }

    @Test public void deadPrinterFallsBackToMainWithWarning() {
        Rig r = new Rig(); r.failOn.add("Kitchen BT");
        PrintEngine.Result res = r.e.print("<html><body><b>T</b></body></html>", "Kitchen BT", 80, 1, "تذكرة الشوي", "");
        assertFalse(res.ok); assertTrue(res.fallback);
        assertEquals(List.of("LAN 192.168.1.50"), r.sent);
        assertTrue(r.htmls.get(r.htmls.size() - 1).contains("طابعة «Kitchen BT» ما اشتغلت"));
        assertTrue(r.htmls.get(r.htmls.size() - 1).contains("<b>T</b>"));
        assertEquals("LAN 192.168.1.50", r.e.jobs().get(0).fallback);
    }

    @Test public void offlineOrMissingDetectedBeforeSending() {
        for (String name : new String[]{"Grill LAN", "Ghost"}) {
            Rig r = new Rig();
            PrintEngine.Result res = r.e.print("x", name, 80, 1, "t", "");
            assertTrue(name, res.fallback);
            assertEquals(name, List.of("LAN 192.168.1.50"), r.sent);
        }
    }

    @Test public void historyKeepsFiftyAndReprints() {
        Rig r = new Rig();
        for (int i = 0; i < 55; i++) r.e.print("job" + i, "Kitchen BT", 80, 1, "فاتورة " + i, null);
        assertEquals(50, r.e.jobs().size());
        assertEquals("فاتورة 54", r.e.jobs().get(0).title);
        assertTrue(r.e.reprint(r.e.jobs().get(0).id).ok);
        assertEquals("job54", r.htmls.get(r.htmls.size() - 1));
        assertEquals("🔁 فاتورة 54", r.e.jobs().get(0).title);
    }

    @Test public void testModeVirtualPrintersGoToSimulatorNotHardware() {
        Rig r = new Rig(); r.list.clear(); r.test = true;
        assertEquals(6, r.e.printers().size());
        assertTrue(r.e.print("r", "", 80, 2, "فاتورة", null).ok);
        assertEquals(List.of(PrintEngine.VPRE + "الكاشير|فاتورة|2"), r.papers);
        PrintEngine.Result off = r.e.print("<html><body>k</body></html>", PrintEngine.VPRE + "مطفية", 80, 1, "قسم", "");
        assertTrue(off.fallback);
        assertEquals(PrintEngine.VPRE + "الكاشير|قسم|1", r.papers.get(r.papers.size() - 1));
        assertTrue(r.sent.isEmpty());
    }

    @Test public void jobsOnSamePrinterNeverOverlap() throws Exception {
        AtomicInteger active = new AtomicInteger(), max = new AtomicInteger();
        List<PrintEngine.Printer> l = List.of(new PrintEngine.Printer("K", "lan", true, "جاهزة", true), new PrintEngine.Printer("G", "lan", true, "جاهزة", false));
        PrintEngine e = new PrintEngine(new PrintEngine.Backend() {
            public List<PrintEngine.Printer> list() { return l; }
            public void send(String p, byte[] d) throws Exception {
                if (p.equals("K")) { max.accumulateAndGet(active.incrementAndGet(), Math::max); }
                Thread.sleep(20);
                if (p.equals("K")) active.decrementAndGet();
            }
        }, (h, w) -> page(), (p, t, c, w, pg) -> {}, () -> false, 1);
        List<Thread> ts = new ArrayList<>();
        for (int i = 0; i < 4; i++) ts.add(new Thread(() -> e.print("a", "K", 80, 1, "t", null)));
        ts.add(new Thread(() -> e.print("b", "G", 80, 1, "t", null)));
        for (Thread t : ts) t.start();
        for (Thread t : ts) t.join();
        assertEquals(1, max.get());
    }

    @Test public void lanPrinterReceivesEscPosBytes() throws Exception {
        try (ServerSocket srv = new ServerSocket(0)) {
            ByteArrayOutputStream got = new ByteArrayOutputStream();
            Thread t = new Thread(() -> { try (Socket s = srv.accept(); InputStream in = s.getInputStream()) { in.transferTo(got); } catch (Exception ignored) {} });
            t.start();
            byte[] job = EscPos.job(new boolean[16], 8, 2, 1);
            NetPrinter.send("127.0.0.1", srv.getLocalPort(), job);
            t.join(3000);
            assertArrayEquals(job, got.toByteArray());
        }
        assertTrue(NetPrinter.validIp("192.168.1.50"));
        assertFalse(NetPrinter.validIp("192.168.1.300"));
        assertFalse(NetPrinter.validIp("printer.local"));
    }

    @Test public void unreachableLanPrinterGivesArabicReason() {
        try { NetPrinter.send("127.0.0.1", 1, new byte[]{1}); fail("should throw"); }
        catch (Exception e) { assertTrue(e.getMessage(), e.getMessage().contains("ما ترد")); }
    }
}
