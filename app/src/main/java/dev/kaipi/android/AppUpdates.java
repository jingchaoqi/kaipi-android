package dev.kaipi.android;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.*;
import android.content.pm.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.*;

/** Android release downloads survive the Activity; verified APKs stay in Downloads. */
final class AppUpdates implements AutoCloseable {
    static final int STORAGE_PERMISSION = 11;
    interface Listener { void update(JSONObject state); }
    private final Activity activity;
    private final Listener listener;
    private final DownloadManager downloads;
    private final SharedPreferences records;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final String installedVersion;
    private ReleaseInfo release;
    private boolean installRequested, verifying, awaitingSettings, awaitingInstaller;
    private ScheduledFuture<?> poll;
    private volatile boolean visible, closed;

    AppUpdates(Activity activity, Listener listener) {
        this.activity = activity; this.listener = listener;
        downloads = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        records = activity.getSharedPreferences("app-updates", Context.MODE_PRIVATE);
        try { installedVersion = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName; }
        catch (PackageManager.NameNotFoundException error) { throw new IllegalStateException(error); }
    }
    void setVisible(boolean value) { visible = value; }
    private void submit(Runnable action) { if (!closed) try { worker.execute(action); } catch (RejectedExecutionException ignored) { } }
    void check() { submit(() -> {
        emit("checking", "", -1);
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("https://api.github.com/repos/" + ReleaseInfo.REPOSITORY + "/releases/latest").openConnection();
            connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setRequestProperty("User-Agent", "kaipi-android/" + installedVersion);
            int status = connection.getResponseCode();
            if (status != 200) throw new IOException(status == 403 || status == 429 ? "rate_limited" : "check_failed");
            ByteArrayOutputStream data = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = in.read(buffer)) != -1) {
                    if (data.size() + count > 2 * 1024 * 1024) throw new IOException("invalid_release");
                    data.write(buffer, 0, count);
                }
            }
            ReleaseInfo latest = ReleaseInfo.parse(new JSONObject(data.toString(StandardCharsets.UTF_8.name())));
            if (release != null && !release.cacheKey().equals(latest.cacheKey())) {
                installRequested = false;
                cancelPoll();
            }
            release = latest;
            refresh();
        } catch (Exception error) { emit("error", code(error, "check_failed"), -1); }
        finally { if (connection != null) connection.disconnect(); }
    }); }
    void install(String assetId) { submit(() -> {
        if (release == null || !Long.toString(release.assetId).equals(assetId)) { emit("error", "check_again", -1); return; }
        if (installRequested || verifying || awaitingSettings || awaitingInstaller) return;
        if (ReleaseInfo.compareVersions(release.version, installedVersion) < 0) { emit("error", "check_again", -1); return; }
        installRequested = true;
        refresh();
    }); }
    @android.annotation.SuppressLint("ApplySharedPref") // Persist the download ID before an installer can replace this process.
    private void refresh() {
        if (closed || release == null) return;
        long id = records.getLong(release.cacheKey(), -1);
        if (id >= 0) {
            try (Cursor row = downloads.query(new DownloadManager.Query().setFilterById(id))) {
                if (row != null && row.moveToFirst()) {
                    int status = row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        // A DownloadManager row can remain after the user removes the file.
                        Uri uri = downloads.getUriForDownloadedFile(id);
                        boolean readable = false;
                        if (uri != null) try (InputStream probe = activity.getContentResolver().openInputStream(uri)) {
                            readable = probe != null;
                        } catch (IOException ignored) { }
                        if (readable) {
                            cancelPoll();
                            if (installRequested && !awaitingSettings && !awaitingInstaller && !verifying) verifyAndInstall(uri);
                            else emit("ready", "", 100);
                            return;
                        }
                    } else if (status != DownloadManager.STATUS_FAILED) {
                        long total = row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        long done = row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        emit("downloading", status == DownloadManager.STATUS_PAUSED ? "download_paused" : "", total > 0 ? (int) (100 * done / total) : -1);
                        if (poll == null) poll = worker.scheduleWithFixedDelay(this::refreshSafely, 1, 1, TimeUnit.SECONDS);
                        return;
                    } else {
                        cancelPoll(); downloads.remove(id); records.edit().remove(release.cacheKey()).apply();
                        if (installRequested) { installRequested = false; emit("error", "download_failed", -1); return; }
                    }
                }
            } catch (Exception error) {
                String reason = code(error, "download_failed");
                if ("verification_failed".equals(reason) || "download_missing".equals(reason)) {
                    downloads.remove(id); records.edit().remove(release.cacheKey()).apply();
                }
                fail(reason); return;
            }
            downloads.remove(id); records.edit().remove(release.cacheKey()).apply();
        }
        if (!installRequested) {
            emit(ReleaseInfo.compareVersions(release.version, installedVersion) > 0 ? "available" : "current", "", -1);
            return;
        }
        if (Build.VERSION.SDK_INT <= 28 && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            emit("permission", "storage_permission", -1);
            activity.runOnUiThread(() -> {
                if (closed) return;
                if (visible) activity.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION);
                else submit(() -> fail("storage_permission"));
            });
            return;
        }
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(release.url))
                .setTitle("kaipi Android " + release.version)
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, release.downloadName());
        try {
            // Save before polling; repeated clicks/restarts look up this exact asset.
            long download = downloads.enqueue(request);
            if (!records.edit().putLong(release.cacheKey(), download).commit()) {
                downloads.remove(download);
                throw new IOException("download_failed");
            }
            refresh();
        } catch (Exception error) { fail("download_failed"); }
    }
    private void refreshSafely() { try { refresh(); } catch (Exception error) { fail("download_failed"); } }
    void storageResult(boolean granted) { submit(() -> { if (granted) refreshSafely(); else fail("storage_permission"); }); }
    private void verifyAndInstall(Uri source) throws Exception {
        verifying = true; emit("verifying", "", 100);
        File folder = new File(activity.getCacheDir(), "updates");
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("verification_failed");
        File apk = new File(folder, "release.apk");
        MessageDigest hash = MessageDigest.getInstance("SHA-256"); long size = 0;
        try (InputStream in = activity.getContentResolver().openInputStream(source); OutputStream out = new FileOutputStream(apk)) {
            if (in == null) throw new IOException("download_missing");
            byte[] buffer = new byte[65536]; int count;
            while ((count = in.read(buffer)) != -1) {
                size += count;
                if (size > release.size) throw new IOException("verification_failed");
                hash.update(buffer, 0, count); out.write(buffer, 0, count);
            }
        }
        StringBuilder digest = new StringBuilder("sha256:");
        for (byte b : hash.digest()) digest.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        if (size != release.size || (!release.digest.isEmpty() && !release.digest.contentEquals(digest))) throw new IOException("verification_failed");
        PackageManager pm = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo packaged = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), flags);
        if (packaged == null || !activity.getPackageName().equals(packaged.packageName)
                || !signatures(packaged).equals(signatures(installed)) || signatures(installed).isEmpty()
                || !release.version.equals(packaged.versionName)
                || (Build.VERSION.SDK_INT >= 28 ? packaged.getLongVersionCode() < installed.getLongVersionCode() : packaged.versionCode < installed.versionCode))
            throw new IOException("verification_failed");
        verifying = false;
        if (!visible) { installRequested = false; emit("ready", "", 100); return; }
        if (!pm.canRequestPackageInstalls()) {
            awaitingSettings = true; emit("permission", "install_permission", 100);
            activity.runOnUiThread(() -> {
                if (closed || !visible) { submit(() -> { awaitingSettings = false; installRequested = false; emit("ready", "", 100); }); return; }
                try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
                catch (ActivityNotFoundException error) { submit(() -> { awaitingSettings = false; fail("installer_unavailable"); }); }
            });
            return;
        }
        awaitingInstaller = true; emit("installing", "", 100);
        activity.runOnUiThread(() -> {
            if (closed || !visible) { submit(() -> { awaitingInstaller = false; installRequested = false; emit("ready", "", 100); }); return; }
            try {
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
                activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
            } catch (ActivityNotFoundException | IllegalArgumentException error) { submit(() -> { awaitingInstaller = false; fail("installer_unavailable"); }); }
        });
    }
    private static Set<Signature> signatures(PackageInfo info) {
        Signature[] values = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null ? info.signingInfo.getApkContentsSigners() : info.signatures;
        return values == null ? new HashSet<>() : new HashSet<>(Arrays.asList(values));
    }
    void resumed() { submit(() -> {
        if (awaitingSettings) {
            awaitingSettings = false;
            if (activity.getPackageManager().canRequestPackageInstalls()) refreshSafely();
            else { installRequested = false; emit("ready", "install_permission", 100); }
        } else if (awaitingInstaller) {
            awaitingInstaller = false; installRequested = false; emit("ready", "", 100);
        }
    }); }
    private void emit(String status, String reason, int progress) {
        if (closed) return;
        try {
            JSONObject state = new JSONObject().put("status", status).put("reason", reason).put("progress", progress).put("installed", installedVersion);
            if (release != null) state.put("version", release.version).put("asset", Long.toString(release.assetId)).put("size", release.size).put("file", release.downloadName());
            listener.update(state);
        } catch (org.json.JSONException error) { throw new IllegalStateException(error); }
    }
    private static String code(Exception error, String fallback) {
        String value = error.getMessage();
        return value != null && value.matches("(?:rate_limited|invalid_release|invalid_version|missing_apk|ambiguous_apk|verification_failed|download_missing)") ? value : fallback;
    }
    private void fail(String reason) { verifying = false; installRequested = false; cancelPoll(); emit("error", reason, -1); }
    private void cancelPoll() { if (poll != null) { poll.cancel(false); poll = null; } }
    @Override public void close() { closed = true; worker.shutdownNow(); }
}
