package com.calivix.carro;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.os.Environment;
import android.os.SystemClock;
import android.util.Log;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Papel de parede próprio da tela inicial: fotos e vídeos (.mp4, animados, sem som) de /sdcard/Calivix/papeis,
 * que o Calivix envia. Troca a cada N minutos e a cada partida. Sem arquivos (ou no modo "sistema"),
 * fica transparente e aparece o papel de parede do Android.
 */
public class Fundo extends FrameLayout implements TextureView.SurfaceTextureListener {
    private static final String TAG = "CarroFundo";
    static final File PASTA = new File(Environment.getExternalStorageDirectory(), "Calivix/papeis");
    private static boolean partida = true; // primeira vez neste processo = a box acabou de ligar

    private final ImageView img;
    private final TextureView video;
    private MediaPlayer mp;
    private Surface sup;
    private File atual;
    private long trocadoEm;
    private boolean ativo;

    public Fundo(Context c) {
        super(c);
        img = new ImageView(c);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        addView(img, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        video = new TextureView(c);
        video.setSurfaceTextureListener(this);
        video.setOpaque(false);
        addView(video, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        img.setVisibility(GONE);
        video.setVisibility(GONE);
    }

    static List<File> arquivos(Context c) {
        List<File> out = new ArrayList<>();
        String modo = Prefs.fundo(c);
        if (Prefs.FUNDO_SISTEMA.equals(modo)) return out;
        File[] fs = PASTA.listFiles();
        if (fs == null) return out;
        Arrays.sort(fs);
        for (File f : fs) {
            String n = f.getName().toLowerCase(Locale.ROOT);
            boolean vid = n.endsWith(".mp4"), foto = n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp");
            if ((vid && !Prefs.FUNDO_FOTOS.equals(modo)) || (foto && !Prefs.FUNDO_ANIMADOS.equals(modo))) out.add(f);
        }
        return out;
    }

    /** Chamado quando a tela inicial aparece e a cada minuto: troca se passou o tempo, ou se mandarem. */
    void atualizar(boolean forcar) {
        List<File> l = arquivos(getContext());
        if (l.isEmpty()) { esconder(); return; }
        int min = Prefs.troca(getContext());
        boolean venceu = min > 0 && SystemClock.elapsedRealtime() - trocadoEm >= min * 60_000L;
        if (forcar || partida || atual == null || !atual.exists() || !l.contains(atual) || venceu) {
            String ultimo = Prefs.p(getContext()).getString("fundoUltimo", "");
            int i = 0;
            for (int k = 0; k < l.size(); k++) if (l.get(k).getName().equals(ultimo)) { i = (k + 1) % l.size(); break; }
            if (l.size() == 1) i = 0;
            partida = false;
            mostrar(l.get(i));
        } else if (ativo) retomar();
    }

    private void esconder() {
        parar();
        atual = null;
        img.setImageDrawable(null);
        img.setVisibility(GONE);
        video.setVisibility(GONE);
    }

    private void mostrar(File f) {
        atual = f;
        trocadoEm = SystemClock.elapsedRealtime();
        Prefs.p(getContext()).edit().putString("fundoUltimo", f.getName()).apply();
        if (f.getName().toLowerCase(Locale.ROOT).endsWith(".mp4")) {
            img.setVisibility(GONE);
            video.setVisibility(VISIBLE);
            tocar();
        } else {
            parar();
            video.setVisibility(GONE);
            new Thread(() -> {
                Bitmap b = decodificar(f);
                post(() -> { if (f.equals(atual)) { img.setImageBitmap(b); img.setVisibility(b != null ? VISIBLE : GONE); } });
            }, TAG).start();
        }
    }

    private Bitmap decodificar(File f) {
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(f.getPath(), o);
            int s = 1;
            while (o.outWidth / (s * 2) >= 1896 && o.outHeight / (s * 2) >= 700) s *= 2;
            BitmapFactory.Options r = new BitmapFactory.Options();
            r.inSampleSize = s;
            return BitmapFactory.decodeFile(f.getPath(), r);
        } catch (Throwable t) { Log.w(TAG, "foto", t); return null; }
    }

    private void tocar() {
        parar();
        if (sup == null || atual == null) return; // toca quando a superfície ficar pronta
        try {
            mp = new MediaPlayer();
            mp.setDataSource(atual.getPath());
            mp.setSurface(sup);
            mp.setLooping(true);
            mp.setVolume(0f, 0f);
            mp.setOnVideoSizeChangedListener((m, w, h) -> recortar(w, h));
            mp.setOnPreparedListener(m -> { if (ativo) m.start(); });
            mp.setOnErrorListener((m, a, b) -> { Log.w(TAG, "vídeo " + a + "/" + b); return true; });
            mp.prepareAsync();
        } catch (Exception e) { Log.w(TAG, "vídeo", e); parar(); }
    }

    /** Preenche a tela sem distorcer (como centerCrop). */
    private void recortar(int vw, int vh) {
        float w = video.getWidth(), h = video.getHeight();
        if (vw <= 0 || vh <= 0 || w <= 0 || h <= 0) return;
        float s = Math.max(w / vw, h / vh);
        Matrix m = new Matrix();
        m.setScale(vw * s / w, vh * s / h, w / 2, h / 2);
        video.setTransform(m);
    }

    private void parar() {
        if (mp != null) { try { mp.release(); } catch (Exception ignored) {} mp = null; }
    }

    void pausar() {
        ativo = false;
        if (mp != null) try { if (mp.isPlaying()) mp.pause(); } catch (Exception ignored) {}
    }

    void retomar() {
        ativo = true;
        if (atual != null && video.getVisibility() == VISIBLE) {
            if (mp == null) tocar();
            else try { mp.start(); } catch (Exception e) { tocar(); }
        }
    }

    void soltar() { parar(); }

    @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) { sup = new Surface(st); if (video.getVisibility() == VISIBLE) tocar(); }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) { if (mp != null) recortar(mp.getVideoWidth(), mp.getVideoHeight()); }
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) { parar(); if (sup != null) sup.release(); sup = null; return true; }
    @Override public void onSurfaceTextureUpdated(SurfaceTexture st) {}

    boolean temProprio() { return atual != null; }
    static boolean visivel(View v) { return v.getVisibility() == VISIBLE; }
}
