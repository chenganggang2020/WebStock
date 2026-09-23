package com.webstock.companion;

import android.content.Context;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

final class BackgroundSyncScheduler {
    static final String PREF_BACKGROUND_SYNC = "background_sync_enabled";
    private static final String UNIQUE_WORK = "webstock-mobile-snapshot-sync";

    private BackgroundSyncScheduler() {}

    static void setEnabled(Context context, boolean enabled) {
        context.getSharedPreferences("webstock_companion", Context.MODE_PRIVATE).edit()
            .putBoolean(PREF_BACKGROUND_SYNC, enabled).apply();
        if (!enabled) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK);
            return;
        }
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            MobileSnapshotWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_WORK, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    static boolean isEnabled(Context context) {
        return context.getSharedPreferences("webstock_companion", Context.MODE_PRIVATE)
            .getBoolean(PREF_BACKGROUND_SYNC, false);
    }
}
