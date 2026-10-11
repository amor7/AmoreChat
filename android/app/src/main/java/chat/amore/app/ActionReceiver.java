package chat.amore.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Notification buttons that work without opening the app (decline a call). */
public class ActionReceiver extends BroadcastReceiver {
    static final String DECLINE = "chat.amore.app.DECLINE";

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!DECLINE.equals(intent.getAction())) return;
        Notifs.cancelCall(c);
        String callId = intent.getStringExtra("callId");
        if (callId == null) return;
        PendingResult pending = goAsync();
        Context app = c.getApplicationContext();
        new Thread(() -> {
            Net.post(app, "/api/calls/" + callId + "/decline");
            pending.finish();
        }).start();
    }
}
