package com.calivix.carro;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.text.Collator;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Todos os apps (arrastar para a esquerda na tela inicial). Toque abre; segurar põe ou tira o app do grupo escolhido.
 * Com o extra GRUPO (segurar um botão de grupo, ou "+"), vira o editor do grupo: nome, apps (toque marca) e excluir.
 * Arrastar para a direita volta.
 */
public class Apps extends Activity {
    static final String GRUPO = "grupo"; // índice do grupo a editar; -1 = grupo novo

    private final List<ResolveInfo> lista = new ArrayList<>();
    private BaseAdapter adaptador;
    private boolean editar;
    private int indice;
    private List<Prefs.Grupo> grupos;
    private Prefs.Grupo grupo;
    private EditText nome;
    private boolean excluido, abriuApp;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        editar = getIntent().hasExtra(GRUPO);
        grupos = Prefs.grupos(this);
        indice = editar ? getIntent().getIntExtra(GRUPO, -1) : Prefs.atual(this);
        if (indice >= grupos.size()) indice = -1;
        if (indice >= 0) grupo = grupos.get(indice);
        else { grupo = new Prefs.Grupo(""); editar = true; }

        PackageManager pm = getPackageManager();
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        for (ResolveInfo ri : pm.queryIntentActivities(i, 0)) {
            if (!ri.activityInfo.packageName.equals(getPackageName())) lista.add(ri);
        }
        Collator col = Collator.getInstance(new Locale("pt", "BR"));
        lista.sort((a, c) -> col.compare(a.loadLabel(pm).toString(), c.loadLabel(pm).toString()));

        Escala raiz = new Escala(this);
        LinearLayout tela = new LinearLayout(this);
        tela.setOrientation(LinearLayout.VERTICAL);
        tela.setPadding(40, 28, 40, 20);
        raiz.addView(tela, new ViewGroup.MarginLayoutParams(Escala.W, Escala.H));

        LinearLayout topo = new LinearLayout(this);
        topo.setGravity(Gravity.CENTER_VERTICAL);
        if (editar) {
            TextView rotulo = texto("Grupo", 22, 0xFFA9B4CC);
            topo.addView(rotulo);
            nome = new EditText(this);
            nome.setText(grupo.nome);
            nome.setHint("Nome do botão (ex.: Vídeos)");
            nome.setHintTextColor(0xFF6F7A93);
            nome.setTextColor(0xFFF4F6FB);
            nome.setTextSize(TypedValue.COMPLEX_UNIT_PX, 30);
            nome.setSingleLine(true);
            nome.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            nome.setImeOptions(EditorInfo.IME_ACTION_DONE);
            nome.setBackgroundResource(R.drawable.bg_botao);
            nome.setPadding(24, 0, 24, 0);
            LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(0, 72, 1);
            np.setMarginStart(18);
            np.setMarginEnd(16);
            topo.addView(nome, np);
            if (indice >= 0 && grupos.size() > 1) topo.addView(botao("Excluir", v -> excluir()), largura(180));
            topo.addView(botao("Pronto", v -> fechar()), largura(180));
        } else {
            topo.addView(texto("Todos os apps", 34, 0xFFF4F6FB), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            topo.addView(botao("Voltar", v -> fechar()), largura(180));
        }
        tela.addView(topo);

        String dica = editar
                ? "Toque nos apps que entram neste botão. Os marcados aparecem na tela inicial ao tocar nele."
                : "Segure um app para pôr ou tirar do grupo “" + grupo.nome + "” · arraste para a direita para voltar";
        TextView d = texto(dica, 19, 0xFFA9B4CC);
        d.setPadding(0, 8, 0, 0);
        tela.addView(d);

        GridView g = new GridView(this);
        g.setNumColumns(9);
        g.setVerticalSpacing(14);
        g.setHorizontalSpacing(10);
        g.setSelector(R.drawable.bg_toque);
        adaptador = new BaseAdapter() {
            @Override public int getCount() { return lista.size(); }
            @Override public Object getItem(int p) { return lista.get(p); }
            @Override public long getItemId(int p) { return p; }
            @Override public View getView(int p, View v, ViewGroup pai) { return celula(lista.get(p)); }
        };
        g.setAdapter(adaptador);
        g.setOnItemClickListener((pai, v, p, id) -> {
            String pkg = lista.get(p).activityInfo.packageName;
            if (editar) { alternar(pkg); return; }
            Intent l = getPackageManager().getLaunchIntentForPackage(pkg);
            if (l != null) { startActivity(l.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); abriuApp = true; finish(); }
        });
        g.setOnItemLongClickListener((pai, v, p, id) -> {
            String pkg = lista.get(p).activityInfo.packageName;
            boolean entrou = alternar(pkg);
            if (!editar) {
                Prefs.salvar(this, grupos);
                Toast.makeText(this, (entrou ? "Posto em “" : "Tirado de “") + grupo.nome + "”", Toast.LENGTH_SHORT).show();
            }
            return true;
        });
        LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1);
        gp.topMargin = 20;
        tela.addView(g, gp);
        setContentView(raiz);
    }

    private boolean alternar(String pkg) {
        boolean entrou;
        if (grupo.apps.remove(pkg)) entrou = false; else { grupo.apps.add(pkg); entrou = true; }
        adaptador.notifyDataSetChanged();
        return entrou;
    }

    private void excluir() {
        excluido = true;
        grupos.remove(indice);
        Prefs.salvar(this, grupos);
        Prefs.atual(this, Math.max(0, Math.min(indice, grupos.size() - 1)));
        Toast.makeText(this, "Grupo excluído", Toast.LENGTH_SHORT).show();
        fechar();
    }

    /** Guarda o grupo editado (ao sair por qualquer caminho). */
    private void guardar() {
        if (!editar || excluido) return;
        String n = nome.getText().toString().trim();
        if (indice < 0) {
            if (n.isEmpty() && grupo.apps.isEmpty()) return; // "+" aberto e nada feito
            grupo.nome = n.isEmpty() ? "Grupo " + (grupos.size() + 1) : n;
            grupos.add(grupo);
            indice = grupos.size() - 1;
        } else {
            grupo.nome = n.isEmpty() ? grupo.nome : n;
        }
        Prefs.salvar(this, grupos);
        Prefs.atual(this, indice);
    }

    private void fechar() {
        if (nome != null) {
            InputMethodManager imm = getSystemService(InputMethodManager.class);
            if (imm != null) imm.hideSoftInputFromWindow(nome.getWindowToken(), 0);
        }
        finish();
    }

    @Override
    public void finish() {
        guardar();
        super.finish();
        if (!abriuApp) overridePendingTransition(R.anim.entra_esquerda, R.anim.sai_direita);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (isFinishing()) return;
        if (editar && indice >= 0 && !excluido) guardar(); // a box desligou ou outro app abriu por cima
    }

    // ---------- arrastar para a direita = voltar ----------

    private float x0, y0;
    private boolean arrastando;

    @Override
    public boolean dispatchTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                x0 = e.getRawX(); y0 = e.getRawY(); arrastando = false; break;
            case MotionEvent.ACTION_MOVE:
                if (!arrastando) {
                    float dx = e.getRawX() - x0, dy = e.getRawY() - y0;
                    int slop = ViewConfiguration.get(this).getScaledTouchSlop() * 3;
                    if (dx > slop && dx > Math.abs(dy) * 1.6f) {
                        arrastando = true;
                        MotionEvent c = MotionEvent.obtain(e);
                        c.setAction(MotionEvent.ACTION_CANCEL);
                        super.dispatchTouchEvent(c);
                        c.recycle();
                    }
                }
                if (arrastando) return true;
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (arrastando) {
                    arrastando = false;
                    if (e.getActionMasked() == MotionEvent.ACTION_UP && e.getRawX() - x0 > getWindow().getDecorView().getWidth() * 0.08f) fechar();
                    return true;
                }
                break;
        }
        return super.dispatchTouchEvent(e);
    }

    // ---------- visual ----------

    private LinearLayout.LayoutParams largura(int w) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, 72);
        p.setMarginStart(12);
        return p;
    }

    private TextView texto(String s, int px, int cor) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(cor);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px);
        return t;
    }

    private TextView botao(String s, View.OnClickListener l) {
        TextView t = texto(s, 24, 0xFFFFFFFF);
        t.setGravity(Gravity.CENTER);
        t.setBackgroundResource(R.drawable.bg_botao);
        t.setForeground(getDrawable(R.drawable.bg_toque));
        t.setOnClickListener(l);
        return t;
    }

    private View celula(ResolveInfo ri) {
        PackageManager pm = getPackageManager();
        boolean marcado = grupo.apps.contains(ri.activityInfo.packageName);
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setGravity(Gravity.CENTER_HORIZONTAL);
        c.setPadding(4, 10, 4, 8);
        if (editar && marcado) c.setBackgroundResource(R.drawable.bg_celula);
        FrameLayout caixa = new FrameLayout(this);
        ImageView iv = new ImageView(this);
        iv.setImageDrawable(ri.loadIcon(pm));
        if (editar && !marcado) iv.setAlpha(0.45f);
        caixa.addView(iv, new FrameLayout.LayoutParams(92, 92));
        if (marcado) {
            TextView marca = texto("✓", 20, 0xFFFFFFFF);
            marca.setGravity(Gravity.CENTER);
            marca.setBackgroundResource(R.drawable.bg_chip_verde);
            caixa.addView(marca, new FrameLayout.LayoutParams(34, 34, Gravity.END | Gravity.TOP));
        }
        c.addView(caixa, new LinearLayout.LayoutParams(100, 100));
        TextView t = texto(ri.loadLabel(pm).toString(), 18, 0xFFE6EBF5);
        t.setSingleLine(true);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setGravity(Gravity.CENTER);
        c.addView(t, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return c;
    }
}
