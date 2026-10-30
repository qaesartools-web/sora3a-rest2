package iq.sora3a.cashier;

import android.webkit.JavascriptInterface;

import org.json.JSONObject;

// الجسر بين الصفحة وشبكة المطعم — نفس واجهة برنامج الحاسبة (window.SoraLan بـ desktop/preload.js)
//  كل التطبيقات: الكاشير «مركز»، وشاشة المطبخ والشاشة والخط يتصلون بيه
public class LanBridge {
    private final MainActivity act;
    private final Lan lan;

    LanBridge(MainActivity act) { this.act = act; this.lan = Lan.get(act); }

    @JavascriptInterface public String role() { return Lan.role(); }
    @JavascriptInterface public String start(String cfg) {
        if (!act.pageOriginOk()) return "null";
        try { return lan.start(new JSONObject(cfg == null ? "{}" : cfg), true).toString(); } catch (Exception e) { return lan.status().toString(); }
    }
    @JavascriptInterface public void stop() { if (act.pageOriginOk()) lan.stop(); }
    @JavascriptInterface public String status() { return act.pageOriginOk() ? lan.status().toString() : "null"; }
    @JavascriptInterface public void send(String to, String json) {
        if (act.pageOriginOk() && json != null && json.length() < LanProto.MAX_LINE && LanProto.parse(json) != null) lan.send(to == null ? "*" : to, json);
    }
    @JavascriptInterface public void broadcast(String json) {
        if (act.pageOriginOk() && json != null && json.length() < 1200 && LanProto.parse(json) != null) lan.broadcast(json);
    }

    // يتحقن ببداية الصفحة (وبعد كل تحميل): window.SoraLan بوعود (Promise) مثل برنامج الحاسبة
    static final String SHIM = "(function(){if(window.SoraLan||!window.SoraLanNative)return;var cbs=[],N=window.SoraLanNative;"
        + "window.__soraLanEv=function(j){var v=null;try{v=JSON.parse(j)}catch(e){return}for(var i=0;i<cbs.length;i++){try{cbs[i](v)}catch(e){}}};"
        + "function P(f){return new Promise(function(r){var s=null;try{s=f()}catch(e){}var v=null;try{v=s?JSON.parse(s):null}catch(e){}r(v)})}"
        + "window.SoraLan={role:N.role(),"
        + "start:function(c){return P(function(){return N.start(JSON.stringify(c||{}))})},"
        + "stop:function(){return P(function(){N.stop();return 'true'})},"
        + "status:function(){return P(function(){return N.status()})},"
        + "send:function(to,m){try{N.send(String(to||'*'),JSON.stringify(m))}catch(e){}},"
        + "broadcast:function(m){try{N.broadcast(JSON.stringify(m))}catch(e){}},"
        + "on:function(cb){cbs.push(cb)}};"
        + "try{window.dispatchEvent(new Event('soralan'))}catch(e){}})();";
}
