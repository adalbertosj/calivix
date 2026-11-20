package com.calivix.carro;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.util.Log;

/**
 * Mantém a "Depuração por Wi-Fi" ligada: o Android a desliga a cada vez que a box reinicia (o carro desliga),
 * e o Calivix precisa dela. Liga de novo na partida, quando a rede volta e sempre que a tela inicial aparece.
 * Precisa de WRITE_SECURE_SETTINGS, que o Calivix concede pelo ADB (pm grant); sem ela, não faz nada.
 * O Android só aceita se a rede Wi-Fi atual já foi permitida para a depuração (a do carro foi, no pareamento).
 */
public class Depuracao extends BroadcastReceiver {
    private static final String TAG = "CarroDepuracao";
    private static final int JOB = 41;

    @Override
    public void onReceive(Context c, Intent i) {
        ligar(c);
        agendar(c);
    }

    static boolean podeLigar(Context c) {
        return c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED;
    }

    static void ligar(Context c) {
        if (!podeLigar(c)) return;
        try {
            if (Settings.Global.getInt(c.getContentResolver(), "adb_enabled", 0) != 1)
                Settings.Global.putInt(c.getContentResolver(), "adb_enabled", 1);
            if (Settings.Global.getInt(c.getContentResolver(), "adb_wifi_enabled", 0) != 1)
                Settings.Global.putInt(c.getContentResolver(), "adb_wifi_enabled", 1);
        } catch (Exception e) {
            Log.w(TAG, "não liguei a depuração por Wi-Fi", e);
        }
    }

    /** Roda de novo quando houver rede (o Wi-Fi do carro costuma conectar depois da partida). */
    static void agendar(Context c) {
        if (!podeLigar(c)) return;
        JobScheduler js = c.getSystemService(JobScheduler.class);
        js.schedule(new JobInfo.Builder(JOB, new ComponentName(c, Trabalho.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(20_000)
                .setOverrideDeadline(10 * 60_000)
                .build());
    }

    public static class Trabalho extends JobService {
        @Override
        public boolean onStartJob(JobParameters p) {
            ligar(this);
            return false;
        }
        @Override
        public boolean onStopJob(JobParameters p) { return false; }
    }
}
