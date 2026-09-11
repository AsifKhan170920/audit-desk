package com.fairtax.portal;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Small helpers so reminders keep working on phones that put apps to sleep (e.g. Samsung). */
@CapacitorPlugin(name = "FTSystem")
public class FTSystemPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        }
        ret.put("batteryUnrestricted", ignoring);
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /** Asks Android to let the app run without battery restrictions. */
    @PluginMethod
    public void allowBackground(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            openAppSettings(call);
        }
    }

    /** Opens this app's page in Android settings (battery, notifications, sounds). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings", e);
        }
    }

    /** Opens the notification settings of the app (sound, pop-up style). */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            openAppSettings(call);
        }
    }
}
