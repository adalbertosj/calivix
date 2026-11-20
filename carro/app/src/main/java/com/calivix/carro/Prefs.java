package com.calivix.carro;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Ajustes guardados: desenho, grupos de apps (os botões ao lado do Wi-Fi) e papel de parede. */
final class Prefs {
    static final String COCKPIT = "cockpit", PALCO = "palco", FAIXA = "faixa";
    static final String YOUTUBE = "com.google.android.youtube";

    // Grupos iniciais (só entram os apps instalados). O primeiro herda os apps que já estavam fixos na versão 1.
    static final List<String> FAVORITOS = Arrays.asList(
            "net.easyconn", "com.waze", "com.google.android.apps.maps", "com.spotify.music",
            "com.google.android.apps.youtube.music", "com.apple.android.music", "com.netflix.mediaclient",
            "com.globo.globotv", "com.wbd.stream", "com.amazon.avod.thirdpartyclient", "com.openai.chatgpt",
            "com.android.chrome", "com.tailscale.ipn");
    static final List<String> VIDEOS = Arrays.asList(
            "com.netflix.mediaclient", "com.globo.globotv", "com.wbd.stream", "com.amazon.avod.thirdpartyclient",
            "br.com.netcombo.now", "com.apple.atve.androidtv.appletv", "com.cbs.ca", "com.brasilparalelo.athena",
            "org.jellyfin.mobile", "com.myanimesbrasilv3", "org.videolan.vlc", "com.hotmart.sparkle");
    static final List<String> MUSICA = Arrays.asList(
            "com.spotify.music", "com.google.android.apps.youtube.music", "com.apple.android.music",
            "deezer.android.app", "com.amazon.mp3", "carnetos.usbmedia", "org.videolan.vlc");
    static final List<String> ESTRADA = Arrays.asList(
            "net.easyconn", "com.waze", "com.google.android.apps.maps", "com.chartcross.gpstestplus",
            "com.google.android.dialer", "com.google.android.apps.messaging", "com.openai.chatgpt");

    static final class Grupo {
        String nome;
        final List<String> apps = new ArrayList<>();
        Grupo(String nome) { this.nome = nome; }
    }

    private Prefs() {}

    static SharedPreferences p(Context c) { return c.getSharedPreferences("carro", Context.MODE_PRIVATE); }

    static String desenho(Context c) { return p(c).getString("desenho", COCKPIT); }
    static void desenho(Context c, String d) { p(c).edit().putString("desenho", d).apply(); }

    // ---------- grupos ----------

    static List<Grupo> grupos(Context c) {
        String s = p(c).getString("grupos", null);
        List<Grupo> out = new ArrayList<>();
        if (s != null) {
            try {
                JSONArray a = new JSONArray(s);
                for (int i = 0; i < a.length(); i++) {
                    JSONObject o = a.getJSONObject(i);
                    Grupo g = new Grupo(o.optString("nome", "Grupo"));
                    JSONArray l = o.optJSONArray("apps");
                    if (l != null) for (int j = 0; j < l.length(); j++) g.apps.add(l.getString(j));
                    out.add(g);
                }
            } catch (Exception ignored) { out.clear(); }
        }
        if (out.isEmpty()) {
            String antigos = p(c).getString("fixos", null); // versão 1
            out.add(inicial(c, "Favoritos", antigos != null ? Arrays.asList(antigos.split(",")) : FAVORITOS));
            out.add(inicial(c, "Vídeos", VIDEOS));
            out.add(inicial(c, "Música", MUSICA));
            out.add(inicial(c, "Estrada", ESTRADA));
            salvar(c, out);
        }
        return out;
    }

    private static Grupo inicial(Context c, String nome, List<String> pkgs) {
        Grupo g = new Grupo(nome);
        PackageManager pm = c.getPackageManager();
        for (String p : pkgs) if (!p.isEmpty() && !p.equals(YOUTUBE) && !g.apps.contains(p) && pm.getLaunchIntentForPackage(p) != null) g.apps.add(p);
        return g;
    }

    static void salvar(Context c, List<Grupo> gs) {
        JSONArray a = new JSONArray();
        try {
            for (Grupo g : gs) {
                JSONObject o = new JSONObject();
                o.put("nome", g.nome);
                o.put("apps", new JSONArray(g.apps));
                a.put(o);
            }
        } catch (Exception ignored) {}
        p(c).edit().putString("grupos", a.toString()).apply();
    }

    static int atual(Context c) {
        int n = grupos(c).size();
        return Math.max(0, Math.min(n - 1, p(c).getInt("grupoAtual", 0)));
    }
    static void atual(Context c, int i) { p(c).edit().putInt("grupoAtual", i).apply(); }

    /** Apps do grupo que estão instalados (os desinstalados ficam guardados, mas não aparecem). */
    static List<String> appsDo(Context c, Grupo g) {
        List<String> out = new ArrayList<>();
        PackageManager pm = c.getPackageManager();
        for (String pkg : g.apps) if (!pkg.equals(YOUTUBE) && pm.getLaunchIntentForPackage(pkg) != null) out.add(pkg);
        return out;
    }

    // ---------- papel de parede ----------
    static final String FUNDO_TUDO = "tudo", FUNDO_ANIMADOS = "animados", FUNDO_FOTOS = "fotos", FUNDO_SISTEMA = "sistema";
    static String fundo(Context c) { return p(c).getString("fundo", FUNDO_TUDO); }
    static void fundo(Context c, String f) { p(c).edit().putString("fundo", f).apply(); }
    /** Minutos entre trocas (0 = só a cada partida). */
    static int troca(Context c) { return p(c).getInt("troca", 30); }
    static void troca(Context c, int m) { p(c).edit().putInt("troca", m).apply(); }
}
