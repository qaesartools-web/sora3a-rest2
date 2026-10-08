package iq.sora3a.cashier;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// الطابعات اللي يشوفها تطبيق الكاشير: طابعات الشبكة (يضيفها المستخدم) + طابعات البلوتوث المقترنة
// (ومنها الطابعة المدمجة بأجهزة الكاشير مثل Sunmi — تطلع باسم InnerPrinter)
public class AndroidBackend implements PrintEngine.Backend {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final Context ctx;
    private final SharedPreferences prefs;
    private final Map<String, String[]> targets = new HashMap<>(); // الاسم ← [نوع، عنوان، منفذ]

    public AndroidBackend(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.prefs = this.ctx.getSharedPreferences("printers", Context.MODE_PRIVATE);
    }

    public JSONArray lan() { try { return new JSONArray(prefs.getString("lan", "[]")); } catch (Exception e) { return new JSONArray(); } }

    public String addLan(String name, String ip, int port) throws Exception {
        if (!NetPrinter.validIp(ip)) throw new Exception("عنوان IP غير صحيح (مثال: 192.168.1.50)");
        if (port <= 0 || port > 65535) port = 9100;
        String label = "🌐 " + ((name == null || name.trim().isEmpty()) ? "طابعة شبكة" : name.trim()) + " (" + ip + ")";
        JSONArray a = lan(), out = new JSONArray();
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i); if (!o.getString("ip").equals(ip)) out.put(o); }
        out.put(new JSONObject().put("name", label).put("ip", ip).put("port", port));
        prefs.edit().putString("lan", out.toString()).apply();
        return label;
    }

    public void removeLan(String label) {
        try {
            JSONArray a = lan(), out = new JSONArray();
            for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i); if (!o.getString("name").equals(label)) out.put(o); }
            prefs.edit().putString("lan", out.toString()).apply();
        } catch (Exception ignored) {}
    }

    boolean btAllowed() {
        return Build.VERSION.SDK_INT < 31 || ctx.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public synchronized List<PrintEngine.Printer> list() {
        List<PrintEngine.Printer> out = new ArrayList<>();
        targets.clear();
        // البلوتوث أولاً: الطابعة المدمجة تكون الافتراضية
        if (btAllowed()) {
            try {
                BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
                if (ad != null && ad.isEnabled()) {
                    for (BluetoothDevice d : ad.getBondedDevices()) {
                        String n = d.getName() == null ? d.getAddress() : d.getName();
                        BluetoothClass bc = d.getBluetoothClass();
                        boolean printer = (bc != null && bc.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING)
                            || n.matches("(?i).*(print|inner|pos|thermal|xp-|rpp|mtp|pt-|zj|goojprt).*");
                        if (!printer) continue;
                        boolean inner = n.equalsIgnoreCase("InnerPrinter");
                        String label = inner ? "🖨️ الطابعة المدمجة بالجهاز" : "🔵 " + n;
                        targets.put(label, new String[]{"bt", d.getAddress(), ""});
                        out.add(new PrintEngine.Printer(label, "bt", true, "جاهزة", inner));
                    }
                }
            } catch (SecurityException ignored) {}
        }
        JSONArray a = lan();
        for (int i = 0; i < a.length(); i++) {
            try {
                JSONObject o = a.getJSONObject(i);
                String ip = o.getString("ip"); int port = o.optInt("port", 9100);
                boolean up = NetPrinter.reachable(ip, port, 700);
                targets.put(o.getString("name"), new String[]{"lan", ip, String.valueOf(port)});
                out.add(new PrintEngine.Printer(o.getString("name"), "lan", up, up ? "جاهزة" : "ما ترد على الشبكة", false));
            } catch (Exception ignored) {}
        }
        boolean hasDefault = false;
        for (PrintEngine.Printer p : out) hasDefault |= p.isDefault;
        if (!hasDefault && !out.isEmpty()) {
            PrintEngine.Printer f = out.get(0);
            out.set(0, new PrintEngine.Printer(f.name, f.kind, f.ok, f.statusText, true));
        }
        return out;
    }

    @Override
    public void send(String printer, byte[] data) throws Exception {
        String[] t;
        synchronized (this) { t = targets.get(printer); }
        if (t == null) { list(); synchronized (this) { t = targets.get(printer); } }
        if (t == null) throw new Exception("الطابعة مو موجودة");
        if ("lan".equals(t[0])) { NetPrinter.send(t[1], Integer.parseInt(t[2]), data); return; }
        if (!btAllowed()) throw new Exception("اسمح للتطبيق باستخدام البلوتوث");
        BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
        if (ad == null || !ad.isEnabled()) throw new Exception("البلوتوث مطفي");
        try {
            ad.cancelDiscovery();
            BluetoothDevice d = ad.getRemoteDevice(t[1]);
            try (BluetoothSocket s = d.createRfcommSocketToServiceRecord(SPP)) {
                s.connect();
                OutputStream o = s.getOutputStream();
                // نرسل بقطع حتى ما تمتلي ذاكرة الطابعة الصغيرة
                for (int i = 0; i < data.length; i += 4096) { o.write(data, i, Math.min(4096, data.length - i)); o.flush(); Thread.sleep(15); }
                Thread.sleep(300);
            }
        } catch (SecurityException e) {
            throw new Exception("اسمح للتطبيق باستخدام البلوتوث");
        } catch (java.io.IOException e) {
            throw new Exception("ما كدرنا نتصل بالطابعة — تأكد إنها شغّالة وقريبة");
        }
    }
}
