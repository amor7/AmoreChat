package chat.amore.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** All notifications the app shows. Ids: 1 = background service, 2 = in call, 3 = incoming call, 1000+chatId = messages. */
final class Notifs {
    private Notifs() {}

    static final String CH_MSG = "messages";
    static final String CH_CALL = "calls";
    static final String CH_SVC = "service";
    static final String CH_INCALL = "incall";
    static final String CH_DL = "downloads";

    static final int ID_SERVICE = 1;
    static final int ID_INCALL = 2;
    static final int ID_RING = 3;

    private static final Map<Long, List<String>> lines = new HashMap<>();

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel msg = new NotificationChannel(CH_MSG, "پیام‌ها", NotificationManager.IMPORTANCE_HIGH);
        msg.enableVibration(true);
        nm.createNotificationChannel(msg);

        NotificationChannel call = new NotificationChannel(CH_CALL, "تماس‌های ورودی", NotificationManager.IMPORTANCE_HIGH);
        call.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        call.enableVibration(true);
        call.setVibrationPattern(new long[] {0, 800, 600, 800});
        call.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(call);

        NotificationChannel svc = new NotificationChannel(CH_SVC, "اتصال پس‌زمینه", NotificationManager.IMPORTANCE_MIN);
        svc.setShowBadge(false);
        nm.createNotificationChannel(svc);

        NotificationChannel incall = new NotificationChannel(CH_INCALL, "تماس در جریان", NotificationManager.IMPORTANCE_LOW);
        incall.setShowBadge(false);
        nm.createNotificationChannel(incall);

        nm.createNotificationChannel(new NotificationChannel(CH_DL, "دانلودها", NotificationManager.IMPORTANCE_LOW));
    }

    static PendingIntent openApp(Context c, int requestCode, String key, String value) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (key != null) i.putExtra(key, value).putExtra("k", Prefs.intentKey(c));
        return PendingIntent.getActivity(c, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void show(Context c, int id, Notification n) {
        try {
            NotificationManagerCompat.from(c).notify(id, n);
        } catch (SecurityException e) {
            // Notification permission not granted.
        }
    }

    static Notification service(Context c, String text) {
        return new NotificationCompat.Builder(c, CH_SVC)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("AmoreChat")
                .setContentText(text)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setContentIntent(openApp(c, 1, null, null))
                .build();
    }

    static void updateService(Context c, String text) {
        show(c, ID_SERVICE, service(c, text));
    }

    static Notification inCall(Context c, String title) {
        return new NotificationCompat.Builder(c, CH_INCALL)
                .setSmallIcon(R.drawable.ic_call)
                .setContentTitle("در تماس")
                .setContentText(title)
                .setOngoing(true)
                .setUsesChronometer(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setContentIntent(openApp(c, 2, null, null))
                .build();
    }

    static synchronized void message(Context c, long chatId, String title, String body, boolean mentioned) {
        List<String> l = lines.get(chatId);
        if (l == null) lines.put(chatId, l = new ArrayList<>());
        l.add(body);
        while (l.size() > 6) l.remove(0);
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle();
        for (String s : l) style.addLine(s);
        if (l.size() > 1) style.setSummaryText(l.size() + " پیام جدید");
        Notification n = new NotificationCompat.Builder(c, CH_MSG)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xFF6366F1)
                .setContentTitle((mentioned ? "@ " : "") + title)
                .setContentText(body)
                .setStyle(style)
                .setNumber(l.size())
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(openApp(c, (int) (100000 + chatId), "chatId", String.valueOf(chatId)))
                .build();
        show(c, (int) (1000 + chatId), n);
    }

    static synchronized void cancelChat(Context c, long chatId) {
        lines.remove(chatId);
        NotificationManagerCompat.from(c).cancel((int) (1000 + chatId));
    }

    static synchronized void cancelAllMessages(Context c) {
        for (Long id : lines.keySet()) NotificationManagerCompat.from(c).cancel((int) (1000 + id));
        lines.clear();
    }

    /** Ringing call: full screen on a locked phone, with answer / decline buttons. */
    static void call(Context c, String callId, String name, boolean video) {
        Intent decline = new Intent(c, ActionReceiver.class).setAction(ActionReceiver.DECLINE).putExtra("callId", callId);
        PendingIntent declinePi = PendingIntent.getBroadcast(c, 3, decline, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent answerPi = openApp(c, 4, "answerCall", callId);
        PendingIntent fullPi = openApp(c, 5, "ringingCall", callId);
        Notification n = new NotificationCompat.Builder(c, CH_CALL)
                .setSmallIcon(R.drawable.ic_call)
                .setColor(0xFF10B981)
                .setContentTitle(name)
                .setContentText(video ? "تماس تصویری ورودی" : "تماس صوتی ورودی")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setTimeoutAfter(60000)
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(fullPi)
                .addAction(0, "رد تماس", declinePi)
                .addAction(0, "پاسخ", answerPi)
                .build();
        n.flags |= Notification.FLAG_INSISTENT;
        show(c, ID_RING, n);
    }

    static void cancelCall(Context c) {
        NotificationManagerCompat.from(c).cancel(ID_RING);
    }

    static Notification download(Context c, int id, String name, int percent, boolean done, PendingIntent open) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_DL)
                .setSmallIcon(done ? android.R.drawable.stat_sys_download_done : android.R.drawable.stat_sys_download)
                .setContentTitle(name)
                .setOnlyAlertOnce(true);
        if (done) {
            b.setContentText("دانلود شد").setAutoCancel(true);
            if (open != null) b.setContentIntent(open);
        } else {
            b.setContentText("در حال دانلود…").setProgress(100, Math.max(0, percent), percent < 0).setOngoing(true);
        }
        Notification n = b.build();
        show(c, id, n);
        return n;
    }

    static void downloadFailed(Context c, int id, String name) {
        show(c, id, new NotificationCompat.Builder(c, CH_DL)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(name)
                .setContentText("دانلود ناموفق بود")
                .setAutoCancel(true)
                .build());
    }
}
