package chat.amore.app;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;

/**
 * Notifications without Google: a light, permanent connection straight to the AmoreChat server
 * (server-sent events). Keeps working when the international internet is cut, as long as the
 * phone can reach the server. Shown as a silent "connected" notification, as Android requires.
 */
public class NotifyService extends Service {
    private volatile boolean running;
    private volatile HttpURLConnection conn;
    private Thread loop;

    static void start(Context c) {
        if (Prefs.server(c) == null || !Prefs.background(c)) return;
        try {
            ContextCompat.startForegroundService(c, new Intent(c, NotifyService.class));
        } catch (Exception e) {
            // Not allowed to start from the background right now; MainActivity starts it next time.
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, NotifyService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Notifs.channels(this);
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING : 0;
        try {
            ServiceCompat.startForeground(this, Notifs.ID_SERVICE, Notifs.service(this, "در حال اتصال…"), type);
        } catch (Exception e) {
            stopSelf();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (loop == null || !loop.isAlive()) {
            running = true;
            loop = new Thread(this::run, "amore-notify");
            loop.start();
        }
        return START_STICKY;
    }

    private void run() {
        long backoff = 2000;
        String lastStatus = null;
        while (running) {
            String server = Prefs.server(this);
            if (server == null) break;
            try {
                HttpURLConnection c = Net.open(this, server + "/api/notify/stream", "GET");
                c.setRequestProperty("Accept", "text/event-stream");
                c.setReadTimeout(75000); // the server pings every 25 s
                conn = c;
                int code = c.getResponseCode();
                if (code == 401) {
                    // Logged out: nothing to listen for until the user signs in again.
                    status("برای دریافت اعلان وارد شوید");
                    lastStatus = null;
                    sleep(60000);
                    continue;
                }
                if (code != 200) throw new Exception("HTTP " + code);
                status("متصل");
                lastStatus = "متصل";
                backoff = 2000;
                BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
                String line;
                while (running && (line = r.readLine()) != null) {
                    if (line.startsWith("data:")) handle(line.substring(5).trim());
                }
            } catch (Exception e) {
                if (!"قطع؛ تلاش دوباره…".equals(lastStatus)) status(lastStatus = "قطع؛ تلاش دوباره…");
            } finally {
                HttpURLConnection c = conn;
                if (c != null) c.disconnect();
                conn = null;
            }
            if (!running) break;
            sleep(backoff);
            backoff = Math.min(backoff * 2, 60000);
        }
    }

    private void status(String text) {
        Notifs.updateService(this, text);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
        }
    }

    private void handle(String data) {
        try {
            JSONObject o = new JSONObject(data);
            String type = o.optString("type");
            switch (type) {
                case "message":
                    // While the app is on screen it shows and sounds its own messages.
                    if (MainActivity.visible) return;
                    Notifs.message(this, o.getLong("chatId"), o.optString("title"), o.optString("body"), o.optBoolean("mentioned"));
                    break;
                case "read":
                    Notifs.cancelChat(this, o.getLong("chatId"));
                    break;
                case "call":
                    if (MainActivity.visible) return;
                    Notifs.call(this, o.getString("callId"), o.optString("name"), o.optBoolean("video"));
                    break;
                case "call_end":
                    Notifs.cancelCall(this);
                    break;
                default:
                    break;
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        HttpURLConnection c = conn;
        if (c != null) new Thread(c::disconnect).start();
        if (loop != null) loop.interrupt();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
