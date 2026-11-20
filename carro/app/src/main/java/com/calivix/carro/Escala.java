package com.calivix.carro;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.view.ViewGroup;

/**
 * As telas são desenhadas em px do painel do carro (1792x700, a área ao lado da barra do sistema).
 * Este contêiner mede o filho nesse tamanho e o escala para a janela real, então o mesmo desenho serve
 * se a janela tiver outro tamanho (outra box, outro carro, saída HDMI espelhada).
 */
public class Escala extends ViewGroup {
    static final int W = 1792, H = 700;

    public Escala(Context c) { super(c); }
    public Escala(Context c, AttributeSet a) { super(c, a); }

    @Override
    protected void onMeasure(int wSpec, int hSpec) {
        for (int i = 0; i < getChildCount(); i++) {
            getChildAt(i).measure(MeasureSpec.makeMeasureSpec(W, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(H, MeasureSpec.EXACTLY));
        }
        setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
    }

    @Override
    protected void onLayout(boolean changed, int l, int t, int r, int b) {
        float w = r - l, h = b - t;
        float s = Math.min(w / W, h / H);
        for (int i = 0; i < getChildCount(); i++) {
            View v = getChildAt(i);
            v.layout(0, 0, W, H);
            v.setPivotX(0);
            v.setPivotY(0);
            v.setScaleX(s);
            v.setScaleY(s);
            v.setTranslationX((w - W * s) / 2);
            v.setTranslationY((h - H * s) / 2);
        }
    }

    @Override
    public LayoutParams generateLayoutParams(AttributeSet attrs) { return new MarginLayoutParams(getContext(), attrs); }
    @Override
    protected LayoutParams generateDefaultLayoutParams() { return new MarginLayoutParams(W, H); }
}
