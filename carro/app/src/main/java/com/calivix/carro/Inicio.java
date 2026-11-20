package com.calivix.carro;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.graphics.RenderEffect;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * A tela inicial do carro. Um dos três desenhos (Cockpit, Palco, Faixa), escolhido nos Ajustes.
 * Arrastar da direita para a esquerda abre todos os apps. Os botões ao lado do Wi-Fi trocam o grupo de apps da grade.
 */
public class Inicio extends Activity {
    private static final String TAG = "CarroInicio";
    private static final String TAILSCALE = "com.tailscale.ipn";
    static final String ACAO_PAPEIS = "com.calivix.carro.PAPEIS";

    private final Handler h = new Handler(Looper.getMainLooper());
    private String desenho;
    private MediaSessionManager msm;
    private ComponentName ouvinte;
    private MediaController yt, musica;
    private final List<MediaController> observados = new ArrayList<>();
    private LocationManager lm;
    private boolean visivel;
    private Fundo fundo;
    private int segundos;
    private final List<ObjectAnimator> eq = new ArrayList<>();
    private String ultimoTituloGuardado;

    private final Runnable tique = new Runnable() {
        @Override public void run() {
            relogio();
            rede();
            progressoYt();
            if (++segundos % 60 == 0 && fundo != null) fundo.atualizar(false);
            h.postDelayed(this, 1000);
        }
    };

    private final MediaController.Callback aoMudarMidia = new MediaController.Callback() {
        @Override public void onPlaybackStateChanged(PlaybackState s) { escolher(); }
        @Override public void onMetadataChanged(MediaMetadata m) { midia(); }
        @Override public void onSessionDestroyed() { sessoes(null); }
    };
    private final MediaSessionManager.OnActiveSessionsChangedListener aoMudarSessoes = this::sessoes;

    private final BroadcastReceiver aoChegarPapeis = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { if (fundo != null) fundo.atualizar(true); }
    };

    private final LocationListener aoMover = new LocationListener() {
        @Override public void onLocationChanged(Location l) {
            TextView v = findViewById(R.id.velocidade);
            if (v == null) return;
            int kmh = l.hasSpeed() ? Math.round(l.getSpeed() * 3.6f) : 0;
            v.setText(String.valueOf(kmh < 2 ? 0 : kmh));
        }
        @Override public void onProviderDisabled(String p) {}
        @Override public void onProviderEnabled(String p) {}
        @Override public void onStatusChanged(String p, int s, Bundle b) {}
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        msm = getSystemService(MediaSessionManager.class);
        ouvinte = new ComponentName(this, Ouvinte.class);
        lm = getSystemService(LocationManager.class);
        montar();
        IntentFilter f = new IntentFilter(ACAO_PAPEIS);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(aoChegarPapeis, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(aoChegarPapeis, f);
        Depuracao.ligar(this);
        Depuracao.agendar(this);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try { unregisterReceiver(aoChegarPapeis); } catch (Exception ignored) {}
        if (fundo != null) fundo.soltar();
        pararEq();
    }

    private void montar() {
        desenho = Prefs.desenho(this);
        int layout = Prefs.PALCO.equals(desenho) ? R.layout.palco : Prefs.FAIXA.equals(desenho) ? R.layout.faixa : R.layout.cockpit;
        if (fundo != null) fundo.soltar();
        pararEq();
        FrameLayout raiz = new FrameLayout(this);
        fundo = new Fundo(this);
        raiz.addView(fundo, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        getLayoutInflater().inflate(layout, raiz, true);
        setContentView(raiz);
        ligarBotoes();
        grupos();
        apps();
        if (Prefs.FAIXA.equals(desenho)) apertarYtParaFaixa();
        manterLivre();
        relogio();
        rede();
        midia();
    }

    @Override
    protected void onResume() {
        super.onResume();
        visivel = true;
        if (!Prefs.desenho(this).equals(desenho)) montar(); else { grupos(); apps(); }
        fundo.retomar();
        fundo.atualizar(false);
        sessoes(null);
        gps(true);
        h.removeCallbacks(tique);
        h.post(tique);
        Depuracao.ligar(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        visivel = false;
        h.removeCallbacks(tique);
        gps(false);
        if (fundo != null) fundo.pausar();
        pararEq();
        try { msm.removeOnActiveSessionsChangedListener(aoMudarSessoes); } catch (Exception ignored) {}
        soltarControles();
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        // Apertar "início" com a tela inicial já aberta: volta ao primeiro grupo? Não: mantém o que a pessoa escolheu.
    }

    @Override
    public void onBackPressed() { /* tela inicial: voltar não sai */ }

    // ---------- arrastar para a esquerda = todos os apps ----------

    private float x0, y0;
    private boolean podeArrastar, arrastando;

    @Override
    public boolean dispatchTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                x0 = e.getRawX(); y0 = e.getRawY();
                arrastando = false;
                podeArrastar = !dentro(R.id.grupos_rolagem, e);
                break;
            case MotionEvent.ACTION_MOVE:
                if (podeArrastar && !arrastando) {
                    float dx = e.getRawX() - x0, dy = e.getRawY() - y0;
                    int slop = ViewConfiguration.get(this).getScaledTouchSlop() * 3;
                    if (dx < -slop && Math.abs(dx) > Math.abs(dy) * 1.6f) {
                        arrastando = true;
                        MotionEvent c = MotionEvent.obtain(e);
                        c.setAction(MotionEvent.ACTION_CANCEL);
                        super.dispatchTouchEvent(c); // solta o botão que estava sob o dedo
                        c.recycle();
                    }
                }
                if (arrastando) return true;
                break;
            case MotionEvent.ACTION_UP:
                if (arrastando) {
                    arrastando = false;
                    float dx = e.getRawX() - x0;
                    if (dx < -getWindow().getDecorView().getWidth() * 0.08f) abrirTodos();
                    return true;
                }
                break;
            case MotionEvent.ACTION_CANCEL:
                if (arrastando) { arrastando = false; return true; }
                break;
        }
        return super.dispatchTouchEvent(e);
    }

    private boolean dentro(int id, MotionEvent e) {
        View v = findViewById(id);
        if (v == null || v.getVisibility() != View.VISIBLE) return false;
        Rect r = new Rect();
        if (!v.getGlobalVisibleRect(r)) return false;
        return r.contains((int) e.getRawX(), (int) e.getRawY());
    }

    private void abrirTodos() {
        try {
            startActivity(new Intent(this, Apps.class));
            overridePendingTransition(R.anim.entra_direita, R.anim.sai_esquerda);
        } catch (Exception e) { Log.w(TAG, "apps", e); }
    }

    private void editarGrupo(int i) {
        startActivity(new Intent(this, Apps.class).putExtra(Apps.GRUPO, i));
        overridePendingTransition(R.anim.entra_direita, R.anim.sai_esquerda);
    }

    // ---------- botões ----------

    private void clique(int id, View.OnClickListener l) {
        View v = findViewById(id);
        if (v != null) v.setOnClickListener(l);
    }

    private void ligarBotoes() {
        clique(R.id.yt_parado, v -> abrirApp(Prefs.YOUTUBE));
        clique(R.id.yt_inscricoes, v -> abrirYt("https://www.youtube.com/feed/subscriptions"));
        clique(R.id.yt_historico, v -> abrirYt("https://www.youtube.com/feed/history"));
        clique(R.id.yt_depois, v -> abrirYt("https://www.youtube.com/playlist?list=WL"));
        clique(R.id.yt_ultimo, v -> continuarUltimo());
        clique(R.id.yt_miniatura_caixa, v -> voltarAoVideo());
        clique(R.id.yt_abrir, v -> voltarAoVideo());
        clique(R.id.yt_play, v -> alternar(yt));
        clique(R.id.yt_menos10, v -> pular(yt, -10_000));
        clique(R.id.yt_mais10, v -> pular(yt, 10_000));
        clique(R.id.mus_play, v -> { if (musica != null) alternar(musica); else retomarUltimoAudio(); });
        clique(R.id.mus_anterior, v -> { if (musica != null) musica.getTransportControls().skipToPrevious(); else tecla(KeyEvent.KEYCODE_MEDIA_PREVIOUS); });
        clique(R.id.mus_proxima, v -> { if (musica != null) musica.getTransportControls().skipToNext(); else tecla(KeyEvent.KEYCODE_MEDIA_NEXT); });
        clique(R.id.mus_info, v -> {
            if (musica != null) { abrirSessao(musica); return; }
            String ult = Prefs.p(this).getString("ultimoAudio", null);
            if (ult != null && getPackageManager().getLaunchIntentForPackage(ult) != null) abrirApp(ult);
            else abrirPrimeiroInstalado("com.spotify.music", "com.apple.android.music", "com.google.android.apps.youtube.music", "deezer.android.app");
        });
        clique(R.id.vpn, v -> abrirApp(TAILSCALE));
        clique(R.id.rede, v -> abrir(new Intent(android.provider.Settings.ACTION_WIFI_SETTINGS)));
        View rel = findViewById(R.id.relogio_card);
        if (rel != null) {
            rel.setOnLongClickListener(v -> { abrir(new Intent(this, Ajustes.class)); return true; });
            rel.setOnClickListener(v -> Toast.makeText(this, "Segure o relógio para abrir os ajustes", Toast.LENGTH_SHORT).show());
        }
    }

    /** Na Faixa o bloco do YouTube é mais estreito: miniatura menor, sem ±10 s, sem "Ver depois" e sem "Continuar". */
    private void apertarYtParaFaixa() {
        View mini = findViewById(R.id.yt_miniatura_caixa);
        if (mini != null) { ViewGroup.LayoutParams p = mini.getLayoutParams(); p.width = 320; p.height = 180; mini.setLayoutParams(p); }
        for (int id : new int[] { R.id.yt_menos10, R.id.yt_mais10, R.id.yt_depois }) { View v = findViewById(id); if (v != null) v.setVisibility(View.GONE); }
        View play = findViewById(R.id.yt_play);
        if (play != null) ((ViewGroup.MarginLayoutParams) play.getLayoutParams()).setMarginStart(0);
    }

    /** Pede ao Android para a janela flutuante do YouTube (PiP) não cobrir a grade de apps nem o cartão de áudio. */
    private void manterLivre() {
        if (Build.VERSION.SDK_INT < 33) return;
        for (int id : new int[] { R.id.apps, R.id.musica, R.id.relogio_card }) {
            View v = findViewById(id);
            if (v != null) v.setPreferKeepClear(true);
        }
    }

    private void abrir(Intent i) {
        try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { Toast.makeText(this, "Não consegui abrir", Toast.LENGTH_SHORT).show(); }
    }

    private void abrirApp(String pkg) {
        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { Toast.makeText(this, "App não instalado", Toast.LENGTH_SHORT).show(); return; }
        abrir(i);
    }

    private void abrirPrimeiroInstalado(String... pkgs) {
        for (String p : pkgs) if (getPackageManager().getLaunchIntentForPackage(p) != null) { abrirApp(p); return; }
    }

    private void abrirYt(String url) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(Prefs.YOUTUBE);
        if (i.resolveActivity(getPackageManager()) == null) { abrirApp(Prefs.YOUTUBE); return; }
        abrir(i);
    }

    private void voltarAoVideo() {
        if (yt != null) abrirSessao(yt); else abrirApp(Prefs.YOUTUBE);
    }

    private void continuarUltimo() {
        String id = Prefs.p(this).getString("ytUltimoId", "");
        if (id.matches("[A-Za-z0-9_-]{11}")) abrirYt("https://youtu.be/" + id);
        else abrirApp(Prefs.YOUTUBE);
    }

    private void abrirSessao(MediaController c) {
        PendingIntent pi = c.getSessionActivity();
        if (pi != null) {
            try { pi.send(); return; } catch (Exception ignored) {}
        }
        abrirApp(c.getPackageName());
    }

    private static boolean tocando(MediaController c) {
        PlaybackState s = c == null ? null : c.getPlaybackState();
        return s != null && (s.getState() == PlaybackState.STATE_PLAYING || s.getState() == PlaybackState.STATE_BUFFERING);
    }

    private void alternar(MediaController c) {
        if (c == null) return;
        if (tocando(c)) c.getTransportControls().pause(); else c.getTransportControls().play();
    }

    private void pular(MediaController c, long ms) {
        if (c == null) return;
        long pos = posicao(c);
        long dur = duracao(c);
        long alvo = Math.max(0, pos + ms);
        if (dur > 0) alvo = Math.min(alvo, dur - 1000);
        c.getTransportControls().seekTo(alvo);
    }

    /** Sem nada tocando, o ▶ manda "tocar" para o último app que tocou (como o botão do volante). */
    private void retomarUltimoAudio() {
        tecla(KeyEvent.KEYCODE_MEDIA_PLAY);
        h.postDelayed(() -> {
            if (musica == null) {
                String ult = Prefs.p(this).getString("ultimoAudio", null);
                if (ult != null) abrirApp(ult);
            }
        }, 1500);
    }

    private void tecla(int codigo) {
        AudioManager am = getSystemService(AudioManager.class);
        long t = SystemClock.uptimeMillis();
        am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, codigo, 0));
        am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_UP, codigo, 0));
    }

    // ---------- relógio, GPS, rede ----------

    private final SimpleDateFormat fmtHora = new SimpleDateFormat("HH:mm", new Locale("pt", "BR"));
    private final SimpleDateFormat fmtData = new SimpleDateFormat("EEEE, d 'de' MMMM", new Locale("pt", "BR"));
    private final SimpleDateFormat fmtDataCurta = new SimpleDateFormat("EEEE, d MMM", new Locale("pt", "BR"));

    private void relogio() {
        Date d = new Date();
        TextView r = findViewById(R.id.relogio), dt = findViewById(R.id.data);
        if (r != null) r.setText(fmtHora.format(d));
        if (dt != null) dt.setText((Prefs.COCKPIT.equals(desenho) ? fmtDataCurta : fmtData).format(d).replace(".", ""));
    }

    private void gps(boolean ligar) {
        if (lm == null) return;
        if (!ligar) { lm.removeUpdates(aoMover); return; }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            TextView v = findViewById(R.id.velocidade);
            if (v != null) v.setText("–");
            return;
        }
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, aoMover, Looper.getMainLooper());
        } catch (Exception e) { Log.w(TAG, "GPS", e); }
    }

    private void rede() {
        TextView rede = findViewById(R.id.rede), vpn = findViewById(R.id.vpn);
        if (rede == null && vpn == null) return;
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        boolean wifi = false, celular = false, tunel = false;
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities c = cm.getNetworkCapabilities(n);
            if (c == null) continue;
            if (c.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) tunel = true;
            else if (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) wifi = true;
            else if (c.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) celular = true;
        }
        if (rede != null) {
            rede.setText(wifi ? "Wi-Fi" : celular ? "4G" : "Sem rede");
            rede.setBackgroundResource(wifi || celular ? R.drawable.bg_chip_azul : R.drawable.bg_chip_cinza);
        }
        if (vpn != null) {
            boolean temTs = getPackageManager().getLaunchIntentForPackage(TAILSCALE) != null;
            vpn.setVisibility(temTs ? View.VISIBLE : View.GONE);
            vpn.setText(tunel ? "Tailscale ligado" : "Tailscale desligado");
            vpn.setBackgroundResource(tunel ? R.drawable.bg_chip_verde : R.drawable.bg_chip_cinza);
            vpn.setTextColor(tunel ? 0xFF9FF0C4 : 0xFFC3CCE0);
        }
    }

    // ---------- grupos (botões ao lado do Wi-Fi) ----------

    private void grupos() {
        LinearLayout box = findViewById(R.id.grupos);
        if (box == null) return;
        box.removeAllViews();
        List<Prefs.Grupo> gs = Prefs.grupos(this);
        int atual = Prefs.atual(this);
        View ativo = null;
        for (int i = 0; i < gs.size(); i++) {
            final int idx = i;
            TextView t = chip(gs.get(i).nome, i == atual);
            t.setOnClickListener(v -> {
                if (Prefs.atual(this) == idx) return;
                Prefs.atual(this, idx);
                grupos();
                apps();
            });
            t.setOnLongClickListener(v -> { editarGrupo(idx); return true; });
            box.addView(t, margem(i));
            if (i == atual) ativo = t;
        }
        TextView mais = chip("+", false);
        mais.setContentDescription("Criar grupo");
        mais.setOnClickListener(v -> editarGrupo(-1));
        box.addView(mais, margem(gs.size()));
        if (ativo != null) {
            final View a = ativo;
            HorizontalScrollView sv = findViewById(R.id.grupos_rolagem);
            if (sv != null) sv.post(() -> sv.smoothScrollTo(Math.max(0, a.getLeft() - 40), 0));
        }
    }

    private LinearLayout.LayoutParams margem(int i) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        if (i > 0) p.setMarginStart(10);
        return p;
    }

    private TextView chip(String nome, boolean ativo) {
        TextView t = new TextView(this);
        t.setText(nome);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, 18);
        t.setPadding(18, 8, 18, 8);
        t.setSingleLine(true);
        t.setTypeface(t.getTypeface(), ativo ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        t.setTextColor(ativo ? 0xFF0B1020 : 0xFFE6EBF5);
        t.setBackgroundResource(ativo ? R.drawable.bg_chip_ativo : R.drawable.bg_chip_grupo);
        t.setForeground(getDrawable(R.drawable.bg_toque));
        return t;
    }

    // ---------- mídia ----------

    private boolean semAcessoMidia() {
        try { msm.getActiveSessions(ouvinte); return false; } catch (SecurityException e) { return true; }
    }

    private void soltarControles() {
        for (MediaController c : observados) c.unregisterCallback(aoMudarMidia);
        observados.clear();
    }

    private static boolean util(MediaController c) {
        PlaybackState s = c.getPlaybackState();
        if (c.getMetadata() == null || s == null) return false;
        int e = s.getState();
        return e != PlaybackState.STATE_NONE && e != PlaybackState.STATE_STOPPED && e != PlaybackState.STATE_ERROR;
    }

    private void sessoes(List<MediaController> lista) {
        if (!visivel) return;
        try {
            if (lista == null) {
                lista = msm.getActiveSessions(ouvinte);
                msm.removeOnActiveSessionsChangedListener(aoMudarSessoes);
                msm.addOnActiveSessionsChangedListener(aoMudarSessoes, ouvinte, h);
            }
        } catch (SecurityException e) {
            lista = new ArrayList<>();
        }
        soltarControles();
        for (MediaController c : lista) {
            c.registerCallback(aoMudarMidia, h);
            observados.add(c);
        }
        escolher();
    }

    /** Qualquer app com sessão de mídia vale para o cartão de áudio: o que está tocando ganha do que está pausado. */
    private void escolher() {
        yt = null;
        musica = null;
        for (MediaController c : observados) {
            if (!util(c)) continue;
            if (Prefs.YOUTUBE.equals(c.getPackageName())) { if (yt == null || (tocando(c) && !tocando(yt))) yt = c; }
            else if (musica == null || (tocando(c) && !tocando(musica))) musica = c;
        }
        if (musica != null && tocando(musica)) Prefs.p(this).edit().putString("ultimoAudio", musica.getPackageName()).apply();
        midia();
    }

    private static String texto(MediaMetadata m, String... chaves) {
        if (m == null) return "";
        for (String k : chaves) { CharSequence s = m.getText(k); if (s != null && s.length() > 0) return s.toString(); }
        return "";
    }

    private static Bitmap imagem(MediaMetadata m) {
        if (m == null) return null;
        for (String k : new String[] { MediaMetadata.METADATA_KEY_ART, MediaMetadata.METADATA_KEY_ALBUM_ART, MediaMetadata.METADATA_KEY_DISPLAY_ICON }) {
            Bitmap b = m.getBitmap(k);
            if (b != null) return b;
        }
        return null;
    }

    private static long duracao(MediaController c) {
        MediaMetadata m = c.getMetadata();
        return m == null ? 0 : m.getLong(MediaMetadata.METADATA_KEY_DURATION);
    }

    private static long posicao(MediaController c) {
        PlaybackState s = c.getPlaybackState();
        if (s == null) return 0;
        long p = s.getPosition();
        if (s.getState() == PlaybackState.STATE_PLAYING && s.getLastPositionUpdateTime() > 0)
            p += (long) ((SystemClock.elapsedRealtime() - s.getLastPositionUpdateTime()) * s.getPlaybackSpeed());
        return Math.max(0, p);
    }

    private static String tempo(long ms) {
        long s = ms / 1000, hh = s / 3600, mm = (s % 3600) / 60, ss = s % 60;
        return hh > 0 ? String.format(Locale.ROOT, "%d:%02d:%02d", hh, mm, ss) : String.format(Locale.ROOT, "%d:%02d", mm, ss);
    }

    private void midia() {
        View tocandoV = findViewById(R.id.yt_tocando), parado = findViewById(R.id.yt_parado);
        if (tocandoV != null && parado != null) {
            tocandoV.setVisibility(yt != null ? View.VISIBLE : View.GONE);
            parado.setVisibility(yt != null ? View.GONE : View.VISIBLE);
        }
        ImageView fundoYt = findViewById(R.id.yt_fundo);
        View scrim = findViewById(R.id.yt_scrim);
        if (yt != null) {
            MediaMetadata m = yt.getMetadata();
            String titulo = texto(m, MediaMetadata.METADATA_KEY_DISPLAY_TITLE, MediaMetadata.METADATA_KEY_TITLE);
            TextView t = findViewById(R.id.yt_titulo);
            if (t != null) t.setText(titulo);
            TextView canal = findViewById(R.id.yt_canal);
            if (canal != null) canal.setText(texto(m, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, MediaMetadata.METADATA_KEY_ALBUM));
            Bitmap b = imagem(m);
            ImageView mini = findViewById(R.id.yt_miniatura);
            if (mini != null) { if (b != null) mini.setImageBitmap(b); else mini.setImageResource(R.drawable.ic_yt); }
            if (fundoYt != null) {
                fundoYt.setVisibility(b != null ? View.VISIBLE : View.GONE);
                if (b != null) {
                    fundoYt.setImageBitmap(b);
                    if (Build.VERSION.SDK_INT >= 31) fundoYt.setRenderEffect(RenderEffect.createBlurEffect(60, 60, Shader.TileMode.CLAMP));
                    else fundoYt.setAlpha(0.35f);
                }
            }
            if (scrim != null) scrim.setVisibility(b != null ? View.VISIBLE : View.GONE);
            boolean toca = tocando(yt);
            ImageButton play = findViewById(R.id.yt_play);
            if (play != null) play.setImageResource(toca ? R.drawable.ic_pause_vermelho : R.drawable.ic_play_vermelho);
            TextView estado = findViewById(R.id.yt_estado);
            if (estado != null) estado.setText(toca ? "TOCANDO AGORA" : "PAUSADO");
            if (toca && visivel) iniciarEq(); else pararEq();
            guardarUltimo(titulo, m, b);
            progressoYt();
        } else {
            if (fundoYt != null) fundoYt.setVisibility(View.GONE);
            if (scrim != null) scrim.setVisibility(View.GONE);
            pararEq();
            mostrarUltimo();
        }
        audio();
    }

    private void audio() {
        TextView mt = findViewById(R.id.mus_titulo), ma = findViewById(R.id.mus_artista), fn = findViewById(R.id.mus_fonte_nome);
        ImageView capa = findViewById(R.id.mus_capa), fi = findViewById(R.id.mus_fonte_icone);
        ImageButton mp = findViewById(R.id.mus_play);
        if (mt == null) return;
        if (musica != null) {
            MediaMetadata m = musica.getMetadata();
            String pkg = musica.getPackageName();
            mt.setText(texto(m, MediaMetadata.METADATA_KEY_DISPLAY_TITLE, MediaMetadata.METADATA_KEY_TITLE));
            String art = texto(m, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_ALBUM_ARTIST, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, MediaMetadata.METADATA_KEY_ALBUM);
            ma.setText(art.isEmpty() ? rotulo(pkg) : art);
            Bitmap b = imagem(m);
            if (b != null) capa.setImageBitmap(b); else { Drawable ic = icone(pkg); if (ic != null) capa.setImageDrawable(ic); else capa.setImageResource(R.drawable.ic_nota); }
            if (mp != null) mp.setImageResource(tocando(musica) ? R.drawable.ic_pause : R.drawable.ic_play);
            fonte(fn, fi, (tocando(musica) ? "" : "PAUSADO · ") + rotulo(pkg).toUpperCase(new Locale("pt", "BR")), icone(pkg));
        } else {
            boolean sem = semAcessoMidia();
            String ult = Prefs.p(this).getString("ultimoAudio", null);
            boolean temUlt = ult != null && getPackageManager().getLaunchIntentForPackage(ult) != null;
            mt.setText(sem ? "Sem acesso às mídias" : "Nada tocando");
            ma.setText(sem ? "O Calivix libera isso pelo servidor" : temUlt ? "▶ retoma o " + rotulo(ult) : "Toque para abrir a música");
            capa.setImageResource(R.drawable.ic_nota);
            if (mp != null) mp.setImageResource(R.drawable.ic_play);
            fonte(fn, fi, "ÁUDIO", null);
        }
    }

    private void fonte(TextView nome, ImageView icone, String s, Drawable d) {
        if (nome != null) nome.setText(s);
        if (icone != null) { icone.setImageDrawable(d); icone.setVisibility(d != null ? View.VISIBLE : View.GONE); }
    }

    private Drawable icone(String pkg) {
        try { return getPackageManager().getApplicationIcon(pkg); } catch (Exception e) { return null; }
    }

    // ----- "Continuar assistindo": guarda o último vídeo do YouTube -----

    private File arquivoUltimo() { return new File(getFilesDir(), "yt_ultimo.jpg"); }

    private void guardarUltimo(String titulo, MediaMetadata m, Bitmap b) {
        if (titulo == null || titulo.isEmpty() || titulo.equals(ultimoTituloGuardado)) return;
        ultimoTituloGuardado = titulo;
        String id = m == null ? "" : m.getString(MediaMetadata.METADATA_KEY_MEDIA_ID);
        Prefs.p(this).edit().putString("ytUltimoTitulo", titulo).putString("ytUltimoId", id == null ? "" : id).apply();
        if (b == null) { arquivoUltimo().delete(); return; }
        Bitmap copia = b.copy(Bitmap.Config.ARGB_8888, false);
        new Thread(() -> {
            try (FileOutputStream o = new FileOutputStream(arquivoUltimo())) { copia.compress(Bitmap.CompressFormat.JPEG, 85, o); }
            catch (Exception e) { Log.w(TAG, "miniatura", e); }
        }, TAG).start();
    }

    private void mostrarUltimo() {
        View caixa = findViewById(R.id.yt_ultimo);
        TextView sub = findViewById(R.id.yt_sub);
        if (caixa == null) return;
        String titulo = Prefs.p(this).getString("ytUltimoTitulo", "");
        boolean tem = !titulo.isEmpty() && !Prefs.FAIXA.equals(desenho);
        caixa.setVisibility(tem ? View.VISIBLE : View.GONE);
        if (sub != null) sub.setText(tem ? "Continue de onde parou" : "Toque para abrir");
        if (!tem) return;
        TextView t = findViewById(R.id.yt_ultimo_titulo);
        if (t != null) t.setText(titulo);
        ImageView img = findViewById(R.id.yt_ultimo_img);
        if (img != null) {
            File f = arquivoUltimo();
            Bitmap b = f.exists() ? BitmapFactory.decodeFile(f.getPath()) : null;
            if (b != null) img.setImageBitmap(b); else img.setImageResource(R.drawable.ic_yt);
        }
    }

    // ----- barrinhas animadas ("tocando agora") -----

    private void iniciarEq() {
        if (!eq.isEmpty()) return;
        int[] ids = { R.id.yt_eq1, R.id.yt_eq2, R.id.yt_eq3 };
        long[] dur = { 420, 560, 360 };
        for (int i = 0; i < ids.length; i++) {
            View v = findViewById(ids[i]);
            if (v == null) continue;
            v.setPivotY(v.getLayoutParams().height);
            ObjectAnimator a = ObjectAnimator.ofFloat(v, View.SCALE_Y, 0.25f, 1f);
            a.setDuration(dur[i]);
            a.setRepeatMode(ValueAnimator.REVERSE);
            a.setRepeatCount(ValueAnimator.INFINITE);
            a.setStartDelay(i * 120L);
            a.start();
            eq.add(a);
        }
    }

    private void pararEq() {
        for (ObjectAnimator a : eq) a.cancel();
        eq.clear();
        for (int id : new int[] { R.id.yt_eq1, R.id.yt_eq2, R.id.yt_eq3 }) {
            View v = findViewById(id);
            if (v != null) { v.setPivotY(v.getLayoutParams().height); v.setScaleY(0.35f); }
        }
    }

    private void progressoYt() {
        if (yt == null) return;
        long dur = duracao(yt), pos = posicao(yt);
        if (dur > 0) pos = Math.min(pos, dur);
        ProgressBar pb = findViewById(R.id.yt_progresso);
        if (pb != null) pb.setProgress(dur > 0 ? (int) (pos * 1000 / dur) : 0);
        TextView d = findViewById(R.id.yt_duracao);
        if (d != null) { d.setVisibility(dur > 0 ? View.VISIBLE : View.GONE); d.setText(tempo(dur)); }
        TextView a = findViewById(R.id.yt_tempo_atual), tt = findViewById(R.id.yt_tempo_total);
        if (a != null) a.setText(dur > 0 ? tempo(pos) : "");
        if (tt != null) tt.setText(dur > 0 ? "-" + tempo(dur - pos) : "");
    }

    private String rotulo(String pkg) {
        try { return getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString(); }
        catch (Exception e) { return pkg; }
    }

    // ---------- grade de apps (do grupo escolhido) ----------

    private void apps() {
        GridLayout g = findViewById(R.id.apps);
        if (g == null) return;
        g.removeAllViews();
        boolean bloco = "bloco".equals(g.getTag());
        int col = g.getColumnCount(), lin = g.getRowCount(), vagas = col * lin;
        List<Prefs.Grupo> gs = Prefs.grupos(this);
        int atual = Prefs.atual(this);
        List<String> lista = gs.isEmpty() ? Collections.emptyList() : Prefs.appsDo(this, gs.get(atual));
        PackageManager pm = getPackageManager();
        int n = 0;
        for (String pkg : lista) {
            if (n >= vagas) break;
            Intent i = pm.getLaunchIntentForPackage(pkg);
            if (i == null) continue;
            ResolveInfo ri = pm.resolveActivity(i, 0);
            Drawable icone = ri != null ? ri.loadIcon(pm) : null;
            String nome = ri != null ? ri.loadLabel(pm).toString() : pkg;
            g.addView(celula(nome, icone, bloco, false, v -> abrir(i), v -> { editarGrupo(atual); return true; }), parametros(n, col));
            n++;
        }
        // Sobrou vaga: um "+" discreto para pôr apps neste grupo.
        if (n < vagas) g.addView(celula("Adicionar", getDrawable(R.drawable.ic_mais), bloco, true, v -> editarGrupo(atual), null), parametros(n, col));
    }

    private static GridLayout.LayoutParams parametros(int n, int col) {
        GridLayout.LayoutParams p = new GridLayout.LayoutParams(GridLayout.spec(n / col, 1f), GridLayout.spec(n % col, 1f));
        p.width = 0;
        p.height = 0;
        p.setMargins(5, 4, 5, 4);
        return p;
    }

    private View celula(String nome, Drawable icone, boolean bloco, boolean acessorio, View.OnClickListener toque, View.OnLongClickListener segurar) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setGravity(Gravity.CENTER);
        c.setBackgroundResource(bloco ? R.drawable.bg_card : R.drawable.bg_toque);
        if (bloco) c.setForeground(getDrawable(R.drawable.bg_toque));
        c.setOnClickListener(toque);
        if (segurar != null) c.setOnLongClickListener(segurar);
        c.setContentDescription(nome);
        if (acessorio) c.setAlpha(0.6f);
        int lado = bloco ? 76 : 84;
        ImageView iv = new ImageView(this);
        iv.setImageDrawable(icone);
        iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
        if (acessorio) { iv.setBackgroundResource(R.drawable.bg_icone); iv.setPadding(22, 22, 22, 22); }
        c.addView(iv, new LinearLayout.LayoutParams(lado, lado));
        TextView t = new TextView(this);
        t.setText(nome);
        t.setTextColor(0xFFE6EBF5);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, bloco ? 22 : 17);
        t.setSingleLine(true);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setGravity(Gravity.CENTER);
        t.setPadding(4, 0, 4, 0);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tp.topMargin = bloco ? 12 : 8;
        c.addView(t, tp);
        return c;
    }
}
