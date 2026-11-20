package com.calivix.carro;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.List;

/** Ajustes (segurar o relógio): desenho, papel de parede, grupos de apps, acesso às mídias e a volta à tela de fábrica. */
public class Ajustes extends Activity {
    private LinearLayout desenhos, modos, tempos, grupos;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Escala raiz = new Escala(this);
        ScrollView rolagem = new ScrollView(this);
        rolagem.setFillViewport(true);
        raiz.addView(rolagem, new ViewGroup.MarginLayoutParams(Escala.W, Escala.H));
        LinearLayout tela = new LinearLayout(this);
        tela.setOrientation(LinearLayout.VERTICAL);
        tela.setPadding(48, 28, 48, 28);
        rolagem.addView(tela, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout topo = new LinearLayout(this);
        topo.setGravity(Gravity.CENTER_VERTICAL);
        topo.addView(texto("Ajustes da tela inicial", 36, 0xFFF4F6FB), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        topo.addView(botao("Voltar", v -> finish(), false), new LinearLayout.LayoutParams(180, 72));
        tela.addView(topo);

        tela.addView(secao("Desenho"));
        desenhos = linha(tela);

        tela.addView(secao("Papel de parede (troca sozinho)"));
        modos = linha(tela);
        tempos = linha(tela);
        ((LinearLayout.LayoutParams) tempos.getLayoutParams()).topMargin = 12;

        tela.addView(secao("Grupos de apps (botões ao lado do Wi-Fi)"));
        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        grupos = new LinearLayout(this);
        hs.addView(grupos, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, 80));
        tela.addView(hs, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 80));
        TextView dicaGrupos = texto("Toque num grupo para mudar o nome, escolher os apps ou excluir. Na tela inicial: toque no botão troca os apps; segurar abre a edição; “+” cria outro.", 18, 0xFFA9B4CC);
        dicaGrupos.setPadding(0, 10, 0, 0);
        tela.addView(dicaGrupos);

        tela.addView(secao("Sistema"));
        LinearLayout l = linha(tela);
        l.addView(botao("Acesso às mídias (YouTube e áudio)", v -> abrir(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS), false), peso());
        l.addView(botao("Tela inicial de fábrica", v -> abrir(Settings.ACTION_HOME_SETTINGS), false), peso());

        String dep = Depuracao.podeLigar(this) ? "ligada automaticamente a cada partida" : "não é mantida (falta a permissão que o Calivix concede)";
        TextView nota = texto("Depuração por Wi-Fi: " + dep + ".\nPapéis de parede próprios: o Calivix envia para /sdcard/Calivix/papeis. Sem nenhum lá (ou em “Do sistema”), fica o papel de parede do Android.\nPara voltar à tela de fábrica: “Tela inicial de fábrica” e escolha a original. Nada da tela de fábrica foi apagado.", 18, 0xFFA9B4CC);
        nota.setPadding(0, 24, 0, 0);
        nota.setLineSpacing(6, 1);
        tela.addView(nota);
        setContentView(raiz);
    }

    @Override
    protected void onResume() {
        super.onResume();
        mostrar();
    }

    private void mostrar() {
        desenhos.removeAllViews();
        String d = Prefs.desenho(this);
        String[][] op = { { Prefs.COCKPIT, "Cockpit" }, { Prefs.PALCO, "Palco do YouTube" }, { Prefs.FAIXA, "Faixa de bordo" } };
        for (String[] o : op) desenhos.addView(botao(o[1], v -> { Prefs.desenho(this, o[0]); mostrar(); }, o[0].equals(d)), peso());

        modos.removeAllViews();
        String f = Prefs.fundo(this);
        String[][] mo = { { Prefs.FUNDO_TUDO, "Fotos e animados" }, { Prefs.FUNDO_ANIMADOS, "Só animados" }, { Prefs.FUNDO_FOTOS, "Só fotos" }, { Prefs.FUNDO_SISTEMA, "Do sistema" } };
        for (String[] o : mo) modos.addView(botao(o[1], v -> { Prefs.fundo(this, o[0]); mostrar(); }, o[0].equals(f)), peso());

        tempos.removeAllViews();
        int t = Prefs.troca(this);
        int[] mins = { 10, 30, 60, 0 };
        for (int m : mins) tempos.addView(botao(m == 0 ? "Só a cada partida" : "A cada " + m + " min", v -> { Prefs.troca(this, m); mostrar(); }, m == t), peso());

        grupos.removeAllViews();
        List<Prefs.Grupo> gs = Prefs.grupos(this);
        for (int i = 0; i < gs.size(); i++) {
            final int idx = i;
            Prefs.Grupo g = gs.get(i);
            TextView bt = botao(g.nome + "  ·  " + Prefs.appsDo(this, g).size(), v -> editar(idx), false);
            bt.setPadding(30, 0, 30, 0);
            grupos.addView(bt, fixo());
        }
        TextView novo = botao("+ Novo grupo", v -> editar(-1), true);
        novo.setPadding(30, 0, 30, 0);
        grupos.addView(novo, fixo());
    }

    private void editar(int i) {
        startActivity(new Intent(this, Apps.class).putExtra(Apps.GRUPO, i));
        overridePendingTransition(R.anim.entra_direita, R.anim.sai_esquerda);
    }

    private LinearLayout linha(LinearLayout pai) {
        LinearLayout l = new LinearLayout(this);
        pai.addView(l, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 80));
        return l;
    }

    private LinearLayout.LayoutParams peso() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1);
        p.setMarginEnd(16);
        return p;
    }

    private LinearLayout.LayoutParams fixo() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT);
        p.setMarginEnd(16);
        return p;
    }

    private TextView texto(String s, int px, int cor) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(cor);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px);
        return t;
    }

    private TextView secao(String s) {
        TextView t = texto(s.toUpperCase(), 18, 0xFFA9B4CC);
        t.setLetterSpacing(0.08f);
        t.setPadding(0, 28, 0, 10);
        return t;
    }

    private TextView botao(String s, View.OnClickListener l, boolean marcado) {
        TextView t = texto(s, 23, marcado ? 0xFFFFFFFF : 0xFFE6EBF5);
        t.setGravity(Gravity.CENTER);
        t.setSingleLine(true);
        t.setBackgroundResource(marcado ? R.drawable.bg_yt : R.drawable.bg_botao);
        t.setForeground(getDrawable(R.drawable.bg_toque));
        t.setOnClickListener(l);
        return t;
    }

    private void abrir(String acao) {
        try { startActivity(new Intent(acao).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
    }
}
