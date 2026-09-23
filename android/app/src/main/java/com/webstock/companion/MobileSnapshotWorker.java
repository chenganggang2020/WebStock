package com.webstock.companion;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.IOException;

public final class MobileSnapshotWorker extends Worker {
    private static final String CHANNEL_ID = "webstock_snapshot_updates";
    private static final int NOTIFICATION_ID = 2048;

    public MobileSnapshotWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences preferences = context.getSharedPreferences("webstock_companion", Context.MODE_PRIVATE);
        if (!preferences.getBoolean(BackgroundSyncScheduler.PREF_BACKGROUND_SYNC, false)) return Result.success();
        String server = preferences.getString("server_url", "");
        String token = preferences.getString("pairing_token", "");
        if (server == null || server.isEmpty() || token == null || token.isEmpty()) return Result.failure();

        String previous = MobileSnapshotStore.read(context.getFilesDir());
        try {
            String current = MobileSnapshotClient.fetch(server, token);
            MobileSnapshotStore.write(context.getFilesDir(), current);
            SnapshotChange change = SnapshotChange.between(previous, current);
            if (change.shouldNotify()) notifyUpdate(context, change.message());
            return Result.success();
        } catch (SecurityException error) {
            preferences.edit().remove("pairing_token").apply();
            return Result.failure();
        } catch (IOException error) {
            return Result.retry();
        } catch (Exception error) {
            return Result.failure();
        }
    }

    private static void notifyUpdate(Context context, String message) {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "WebStock 数据更新", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Windows 主机同步的账户快照与研究资料更新");
        manager.createNotificationChannel(channel);
        Intent intent = new Intent(context, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("WebStock 数据已更新")
            .setContentText(message)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build();
        manager.notify(NOTIFICATION_ID, notification);
    }
}
