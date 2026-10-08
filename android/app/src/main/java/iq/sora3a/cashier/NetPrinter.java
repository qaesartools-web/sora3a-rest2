package iq.sora3a.cashier;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

// طابعة شبكة (LAN / Wi-Fi) على المنفذ 9100 — الأشهر لطابعات المطبخ
public final class NetPrinter {
    private NetPrinter() {}

    public static boolean validIp(String ip) {
        if (ip == null || !ip.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        for (String p : ip.split("\\.")) if (Integer.parseInt(p) > 255) return false;
        return true;
    }

    public static boolean reachable(String ip, int port, int timeoutMs) {
        try (Socket s = new Socket()) { s.connect(new InetSocketAddress(ip, port), timeoutMs); return true; }
        catch (Exception e) { return false; }
    }

    public static void send(String ip, int port, byte[] data) throws Exception {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(ip, port), 4000);
            s.setSoTimeout(8000);
            OutputStream o = s.getOutputStream();
            o.write(data);
            o.flush();
            Thread.sleep(150); // نعطي الطابعة وقت تستلم قبل ما نسكّر
        } catch (java.net.ConnectException | java.net.SocketTimeoutException e) {
            throw new Exception("الطابعة ما ترد على " + ip + " — تأكد إنها شغّالة وعلى نفس الشبكة");
        }
    }
}
