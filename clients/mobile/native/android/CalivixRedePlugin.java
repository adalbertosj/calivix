package app.calivix.app;

// Dá à interface o que o WebView não tem: sockets TCP para falar ADB com as TVs, varredura da rede local,
// informações da rede Wi-Fi e HTTP para os aparelhos da rede. Mesmo contrato do app de computador.
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "CalivixRede")
public class CalivixRedePlugin extends Plugin {
    private final Map<Integer, Socket> sockets = new ConcurrentHashMap<>();
    private final Map<Integer, ExecutorService> escritores = new ConcurrentHashMap<>();
    private final AtomicInteger proximo = new AtomicInteger(1);
    private final ExecutorService varredura = Executors.newFixedThreadPool(96);
    private String ultimaRede = "";

    @Override
    public void load() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { avisarRede(); }
            @Override public void onLost(Network n) { avisarRede(); }
        });
    }

    private void avisarRede() {
        JSObject r = lerRede();
        String ip = r.optString("ip", "");
        if (!ip.equals(ultimaRede)) { ultimaRede = ip; notifyListeners("rede", new JSObject()); }
    }

    // ---------- sockets TCP (ADB) ----------
    @PluginMethod
    public void tcpConectar(PluginCall call) {
        String host = call.getString("host");
        int porta = call.getInt("porta", 5555);
        int ms = call.getInt("ms", 8000);
        new Thread(() -> {
            Socket s = new Socket();
            try {
                s.setTcpNoDelay(true);
                s.connect(new InetSocketAddress(host, porta), ms);
            } catch (ConnectException e) {
                fecharSilencioso(s);
                String m = String.valueOf(e.getMessage());
                call.reject(m.contains("ECONNREFUSED") || m.contains("refused") ? host + " recusou a porta " + porta + ": a depuração pela rede está desligada na TV" : host + " não está alcançável desta rede");
                return;
            } catch (Exception e) {
                fecharSilencioso(s);
                call.reject(e instanceof java.net.SocketTimeoutException ? "Sem resposta de " + host + ":" + porta : host + " não está alcançável desta rede");
                return;
            }
            int id = proximo.getAndIncrement();
            sockets.put(id, s);
            escritores.put(id, Executors.newSingleThreadExecutor());
            JSObject r = new JSObject(); r.put("id", id);
            call.resolve(r);
            ler(id, s);
        }).start();
    }

    private void ler(int id, Socket s) {
        String erro = null;
        try {
            InputStream in = s.getInputStream();
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                JSObject d = new JSObject();
                d.put("id", id);
                d.put("dados", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
                notifyListeners("dados", d);
            }
        } catch (Exception e) {
            erro = e.getMessage();
        }
        if (sockets.remove(id) != null) {
            ExecutorService w = escritores.remove(id); if (w != null) w.shutdown();
            fecharSilencioso(s);
            JSObject d = new JSObject(); d.put("id", id); if (erro != null) d.put("erro", erro);
            notifyListeners("fechado", d);
        }
    }

    @PluginMethod
    public void tcpEscrever(PluginCall call) {
        int id = call.getInt("id", 0);
        Socket s = sockets.get(id);
        ExecutorService w = escritores.get(id);
        if (s == null || w == null) { call.reject("conexão fechada"); return; }
        byte[] dados = Base64.decode(call.getString("dados", ""), Base64.DEFAULT);
        // um escritor por conexão: a ordem dos pacotes importa
        w.execute(() -> {
            try { OutputStream out = s.getOutputStream(); out.write(dados); out.flush(); call.resolve(); }
            catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        });
    }

    @PluginMethod
    public void tcpFechar(PluginCall call) {
        int id = call.getInt("id", 0);
        Socket s = sockets.remove(id);
        ExecutorService w = escritores.remove(id); if (w != null) w.shutdown();
        if (s != null) fecharSilencioso(s);
        call.resolve();
    }

    private static void fecharSilencioso(Socket s) { try { s.close(); } catch (Exception ignored) { } }

    // ---------- descoberta ----------
    @PluginMethod
    public void sondar(PluginCall call) {
        JSArray hosts = call.getArray("hosts", new JSArray());
        JSArray portas = call.getArray("portas", new JSArray());
        int ms = call.getInt("ms", 600);
        new Thread(() -> {
            try {
                List<String> hs = hosts.toList();
                List<Integer> ps = new ArrayList<>();
                for (Object p : portas.toList()) ps.add(((Number) p).intValue());
                Map<String, List<Integer>> achados = new ConcurrentHashMap<>();
                List<Future<?>> tarefas = new ArrayList<>();
                for (String h : hs) {
                    achados.put(h, Collections.synchronizedList(new ArrayList<>()));
                    for (int p : ps) {
                        tarefas.add(varredura.submit(() -> {
                            try (Socket s = new Socket()) { s.connect(new InetSocketAddress(h, p), ms); achados.get(h).add(p); }
                            catch (Exception ignored) { }
                        }));
                    }
                }
                for (Future<?> f : tarefas) f.get();
                JSArray itens = new JSArray();
                for (String h : hs) {
                    List<Integer> l = new ArrayList<>(achados.get(h)); Collections.sort(l);
                    JSObject o = new JSObject(); o.put("host", h); o.put("portas", new JSArray(l));
                    itens.put(o);
                }
                JSObject r = new JSObject(); r.put("itens", itens);
                call.resolve(r);
            } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        }).start();
    }

    private JSObject lerRede() {
        JSObject r = new JSObject();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.getName().startsWith("tun")) continue; // ignora a Tailnet (VPN)
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress a = ia.getAddress();
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    int bits = ia.getNetworkPrefixLength();
                    long m = bits == 0 ? 0 : (0xffffffffL << (32 - bits)) & 0xffffffffL;
                    r.put("ip", a.getHostAddress());
                    r.put("mascara", ((m >> 24) & 255) + "." + ((m >> 16) & 255) + "." + ((m >> 8) & 255) + "." + (m & 255));
                    r.put("interface", ni.getName());
                    if (ni.getName().startsWith("wlan") || ni.getName().startsWith("eth")) return r;
                }
            }
        } catch (Exception ignored) { }
        if (!r.has("ip")) r.put("ip", JSObject.NULL);
        return r;
    }

    @PluginMethod
    public void infoRede(PluginCall call) { call.resolve(lerRede()); }

    @PluginMethod
    public void httpGet(PluginCall call) {
        String url = call.getString("url", "");
        int ms = call.getInt("ms", 3000);
        if (!url.matches("^http://(10|172|192)\\.[\\d.]+:\\d+/.*")) { call.reject("Só endereços da rede local"); return; }
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(ms); c.setReadTimeout(ms);
                int st = c.getResponseCode();
                InputStream in = st >= 400 ? c.getErrorStream() : c.getInputStream();
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                if (in != null) { byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0 && b.size() < 2_000_000) b.write(buf, 0, n); }
                JSObject r = new JSObject(); r.put("status", st); r.put("texto", b.toString("UTF-8"));
                call.resolve(r);
            } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        }).start();
    }

    @PluginMethod
    public void abrir(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("http://") && !url.startsWith("https://")) { call.reject("Endereço inválido"); return; }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
