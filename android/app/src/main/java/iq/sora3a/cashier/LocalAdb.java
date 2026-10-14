package iq.sora3a.cashier;

import android.content.Context;
import android.util.Base64;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;

import javax.crypto.Cipher;

// تطبيق الشاشة: «الفتح مثل الريموت». بعض التلفزيونات تمنع التطبيقات تفتح نفسها، بس أوامر «وضع المطوّر» (ADB)
// التلفزيون يعاملها مثل ما شخص يفتح التطبيق بالريموت. التطبيق يتصل بالتلفزيون نفسه (127.0.0.1:5555) بمفتاح خاص بيه
// (يبقى بملفات التطبيق بس)، والتلفزيون يسأل مرة وحدة «السماح؟». المطعم هو اللي يفعّل وضع المطوّر ويوافق.
// الأوامر ثابتة بالكود (فتح الشاشة وتثبيت إعداداتها) — الصفحة ما تكدر تبعث أوامر.
// بروتوكول ADB: رسائل 24 بايت (أمر، معاملين، طول، مجموع، عكس الأمر) + بيانات.
final class LocalAdb {
    private static final int CNXN = 0x4e584e43, AUTH = 0x48545541, OPEN = 0x4e45504f, CLSE = 0x45534c43, WRTE = 0x45545257, OKAY = 0x59414b4f;
    private static final int VERSION = 0x01000000, MAXDATA = 4096, TOKEN = 1, SIGNATURE = 2, RSAPUBLICKEY = 3;
    private static final int PORT = 5555;
    private static final byte[] SHA1_PREFIX = {0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14};
    private static final String OK_FILE = "adb.ok";

    private LocalAdb() {}

    // وضع المطوّر (تصحيح الشبكة) مو مفعّل بالتلفزيون
    static final class Off extends Exception {}
    // التلفزيون سأل «السماح؟» وما انضغط موافق
    static final class NotAllowed extends Exception {}

    // انضبط مرة (التلفزيون سمح) — ملف حتى تشوفه عملية المراقبة هم
    static boolean ready(Context ctx) { return new File(ctx.getFilesDir(), OK_FILE).exists(); }
    static void setReady(Context ctx, boolean on) {
        File f = new File(ctx.getFilesDir(), OK_FILE);
        if (!on) { f.delete(); return; }
        try (FileOutputStream o = new FileOutputStream(f)) { o.write('1'); } catch (Exception ignored) {}
    }

    // أمر واحد ويرجّع ناتجه. approvalWaitMs > 0: إذا التلفزيون ما يعرف مفتاحنا نطلب «السماح» وننتظر هالمدة
    static synchronized String shell(Context ctx, String cmd, long approvalWaitMs) throws Exception {
        KeyPair kp = keys(ctx, approvalWaitMs > 0);
        if (kp == null) throw new NotAllowed();
        Socket s = new Socket();
        try {
            try { s.connect(new InetSocketAddress("127.0.0.1", PORT), 3000); } catch (IOException e) { throw new Off(); }
            s.setSoTimeout(10_000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            handshake(s, in, out, kp, approvalWaitMs);
            s.setSoTimeout(15_000);
            send(out, OPEN, 1, 0, ("shell:" + cmd + "\0").getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            while (true) {
                Msg m = recv(in);
                if (m.cmd == WRTE) { sb.append(new String(m.data, StandardCharsets.UTF_8)); send(out, OKAY, 1, m.a0, null); }
                else if (m.cmd == CLSE) { send(out, CLSE, 1, m.a0, null); return sb.toString().trim(); }
                // OKAY = انفتح الطلب؛ نكمل نقرا
            }
        } finally { try { s.close(); } catch (Exception ignored) {} }
    }

    private static void handshake(Socket s, InputStream in, OutputStream out, KeyPair kp, long approvalWaitMs) throws Exception {
        send(out, CNXN, VERSION, MAXDATA, "host::\0".getBytes(StandardCharsets.UTF_8));
        boolean signed = false, offered = false;
        while (true) {
            Msg m;
            try { m = recv(in); } catch (SocketTimeoutException e) { if (offered) throw new NotAllowed(); throw e; }
            if (m.cmd == CNXN) return;   // متصلين
            if (m.cmd != AUTH || m.a0 != TOKEN) throw new IOException("adb " + Integer.toHexString(m.cmd));
            if (!signed) { send(out, AUTH, SIGNATURE, 0, sign(kp.getPrivate(), m.data)); signed = true; continue; }
            if (offered || approvalWaitMs <= 0) throw new NotAllowed();
            // التلفزيون ما يعرف مفتاحنا ← يطلع رسالة «السماح بتصحيح USB؟» وننتظر الموافقة
            send(out, AUTH, RSAPUBLICKEY, 0, publicKey((RSAPublicKey) kp.getPublic()));
            offered = true;
            s.setSoTimeout((int) approvalWaitMs);
        }
    }

    // ── المفتاح: يتولد مرة وقت الضبط (المطعم ضغط الزر) ويبقى بملفات التطبيق ──
    private static KeyPair keys(Context ctx, boolean create) throws Exception {
        File pub = new File(ctx.getFilesDir(), "adbkey.pub"), pri = new File(ctx.getFilesDir(), "adbkey");
        KeyFactory kf = KeyFactory.getInstance("RSA");
        if (pub.exists() && pri.exists())
            return new KeyPair(kf.generatePublic(new X509EncodedKeySpec(read(pub))), kf.generatePrivate(new PKCS8EncodedKeySpec(read(pri))));
        if (!create) return null;
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        KeyPair kp = g.generateKeyPair();
        write(pri, kp.getPrivate().getEncoded());
        write(pub, kp.getPublic().getEncoded());
        return kp;
    }

    // توقيع رمز التلفزيون: RSA PKCS#1 v1.5 والرمز نفسه يُعامل كبصمة SHA-1 (مثل adb بالكمبيوتر)
    static byte[] sign(PrivateKey k, byte[] token) throws Exception {
        byte[] block = new byte[256];
        int sep = block.length - 1 - SHA1_PREFIX.length - token.length;
        block[0] = 0; block[1] = 1;
        for (int i = 2; i < sep; i++) block[i] = (byte) 0xff;
        block[sep] = 0;
        System.arraycopy(SHA1_PREFIX, 0, block, sep + 1, SHA1_PREFIX.length);
        System.arraycopy(token, 0, block, sep + 1 + SHA1_PREFIX.length, token.length);
        Cipher c = Cipher.getInstance("RSA/ECB/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, k);
        return c.doFinal(block);
    }

    // المفتاح العام بصيغة أندرويد: len, n0inv, n[64], rr[64], e (little-endian) بـ base64 + اسم
    static byte[] publicKey(RSAPublicKey pk) {
        BigInteger n = pk.getModulus(), r32 = BigInteger.ONE.shiftLeft(32);
        BigInteger n0inv = r32.subtract(n.mod(r32).modInverse(r32)).mod(r32);
        BigInteger rr = BigInteger.ONE.shiftLeft(4096).mod(n);
        ByteBuffer bb = ByteBuffer.allocate(4 + 4 + 256 + 256 + 4).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(64).putInt(n0inv.intValue());
        for (int i = 0; i < 64; i++) bb.putInt(n.shiftRight(32 * i).mod(r32).intValue());
        for (int i = 0; i < 64; i++) bb.putInt(rr.shiftRight(32 * i).mod(r32).intValue());
        bb.putInt(pk.getPublicExponent().intValue());
        return (Base64.encodeToString(bb.array(), Base64.NO_WRAP) + " sora3a@screen\0").getBytes(StandardCharsets.UTF_8);
    }

    // ── الرسائل ──
    private static final class Msg { int cmd, a0, a1; byte[] data; }

    private static void send(OutputStream o, int cmd, int a0, int a1, byte[] data) throws IOException {
        int len = data == null ? 0 : data.length, sum = 0;
        if (data != null) for (byte b : data) sum += b & 0xff;
        ByteBuffer bb = ByteBuffer.allocate(24 + len).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(cmd).putInt(a0).putInt(a1).putInt(len).putInt(sum).putInt(~cmd);
        if (data != null) bb.put(data);
        o.write(bb.array());
        o.flush();
    }

    private static Msg recv(InputStream in) throws IOException {
        ByteBuffer bb = ByteBuffer.wrap(readFully(in, 24)).order(ByteOrder.LITTLE_ENDIAN);
        Msg m = new Msg();
        m.cmd = bb.getInt(); m.a0 = bb.getInt(); m.a1 = bb.getInt();
        int len = bb.getInt();
        if (len < 0 || len > 1 << 20) throw new IOException("adb len " + len);
        m.data = len > 0 ? readFully(in, len) : new byte[0];
        return m;
    }

    private static byte[] readFully(InputStream in, int n) throws IOException {
        byte[] b = new byte[n];
        for (int off = 0; off < n; ) {
            int r = in.read(b, off, n - off);
            if (r < 0) throw new IOException("adb closed");
            off += r;
        }
        return b;
    }

    private static byte[] read(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) { return readFully(in, (int) f.length()); }
    }

    private static void write(File f, byte[] b) throws IOException {
        try (OutputStream o = new FileOutputStream(f)) { o.write(b); }
    }
}
