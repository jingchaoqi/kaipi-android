package dev.kaipi.android;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Android file delivery. No core calls and no permission to publish app configuration. */
final class WorkspaceFiles implements AutoCloseable {
    static final int STORAGE_PERMISSION = 83;
    private final Activity activity;
    private final Consumer<JSONObject> publish;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean closed;
    private boolean saving;
    private String pendingWorkspace, pendingPath;
    WorkspaceFiles(Activity activity, Consumer<JSONObject> publish) { this.activity = activity; this.publish = publish; }
    private void event(String status, String request, Object data) {
        activity.runOnUiThread(() -> {
            if (closed) return;
            try { publish.accept(new JSONObject().put("status", status).put("request", request).put("data", data)); }
            catch (JSONException error) { throw new IllegalStateException(error); }
        });
    }
    void list(String workspace, String request, String path) {
        worker.execute(() -> {
            try { event("listed", request, WorkspaceStorage.list(WorkspaceStorage.root(activity, workspace), path)); }
            catch (Exception error) { event("list_error", request, "无法读取这个目录。"); }
        });
    }
    void open(String workspace, String path, String appearance) {
        worker.execute(() -> {
            try {
                File root = WorkspaceStorage.root(activity, workspace), file = WorkspaceStorage.resolve(root, path);
                if (file.isDirectory()) { event("directory", "", WorkspaceStorage.relative(root, file)); return; }
                if (!file.isFile()) throw new IOException();
                String mime = WorkspaceStorage.mime(file);
                if (WorkspaceStorage.text(file) || mime.startsWith("image/")) {
                    Intent intent = new Intent(activity, FilePreviewActivity.class).putExtra("workspace", workspace)
                        .putExtra("path", WorkspaceStorage.relative(root, file)).putExtra("appearance", appearance);
                    activity.runOnUiThread(() -> { if (!closed) activity.startActivity(intent); });
                } else handOff(file, false);
            } catch (Exception error) { event("error", "", "无法打开文件。它可能已被移动，或不在当前工作区中。"); }
        });
    }
    void share(String workspace, String path) {
        worker.execute(() -> {
            try {
                File file = WorkspaceStorage.resolve(WorkspaceStorage.root(activity, workspace), path);
                if (!file.isFile()) throw new IOException();
                handOff(file, true);
            } catch (Exception error) { event("error", "", "无法分享这个文件。"); }
        });
    }
    private void handOff(File source, boolean share) throws IOException {
        File directory = new File(activity.getCacheDir(), "exports/" + UUID.randomUUID());
        if (!directory.mkdirs()) throw new IOException();
        File snapshot = new File(directory, source.getName());
        try (InputStream in = new FileInputStream(source); OutputStream out = new FileOutputStream(snapshot)) { WorkspaceStorage.copy(in, out); }
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", snapshot);
        Intent intent = new Intent(share ? Intent.ACTION_SEND : Intent.ACTION_VIEW);
        if (share) intent.setType(WorkspaceStorage.mime(source)).putExtra(Intent.EXTRA_STREAM, uri);
        else intent.setDataAndType(uri, WorkspaceStorage.mime(source));
        intent.setClipData(ClipData.newRawUri("", uri)); intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.runOnUiThread(() -> {
            if (closed) return;
            try { activity.startActivity(share ? Intent.createChooser(intent, null) : intent); }
            catch (ActivityNotFoundException error) { event("error", "", "没有可打开此文件的应用，请保存到 Downloads 后使用其他应用打开。"); }
        });
    }
    void save(String workspace, String path) {
        if (saving || pendingPath != null || closed) return;
        if (Build.VERSION.SDK_INT <= 28 && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingWorkspace = workspace; pendingPath = path;
            activity.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION);
            return;
        }
        saving = true; event("saving", "", "正在保存文件…");
        worker.execute(() -> {
            try {
                File root = WorkspaceStorage.root(activity, workspace), source = WorkspaceStorage.resolve(root, path);
                File archive = null;
                try {
                    if (source.isDirectory()) {
                        File staging = new File(activity.getCacheDir(), "exports/" + UUID.randomUUID());
                        if (!staging.mkdirs()) throw new IOException();
                        archive = new File(staging, source.equals(root) ? "kaipi-workspace.zip" : source.getName() + ".zip");
                        WorkspaceStorage.zip(root, source, archive);
                    } else if (!source.isFile()) throw new IOException();
                    saveDownload(archive == null ? source : archive);
                } finally { if (archive != null) archive.delete(); }
                event("saved", "", "已保存到 Downloads。");
            } catch (Exception error) { event("error", "", "保存失败，请检查可用空间和文件是否存在。"); }
            finally { activity.runOnUiThread(() -> saving = false); }
        });
    }
    void permissionResult(boolean granted) {
        String workspace = pendingWorkspace, path = pendingPath;
        pendingWorkspace = pendingPath = null;
        if (path == null) return;
        if (granted) save(workspace, path);
        else event("error", "", "请允许将文件保存到 Downloads，然后重试。");
    }
    private void saveDownload(File source) throws IOException {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver resolver = activity.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, source.getName());
            values.put(MediaStore.Downloads.MIME_TYPE, WorkspaceStorage.mime(source));
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/kaipi");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException();
            boolean completed = false;
            try {
                try (InputStream in = new FileInputStream(source); OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IOException();
                    WorkspaceStorage.copy(in, out);
                }
                ContentValues done = new ContentValues(); done.put(MediaStore.Downloads.IS_PENDING, 0);
                if (resolver.update(uri, done, null, null) != 1) throw new IOException();
                completed = true;
            } finally { if (!completed) resolver.delete(uri, null, null); }
        } else {
            File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "kaipi");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException();
            File target = new File(directory, source.getName());
            for (int i = 1; !target.createNewFile(); i++) {
                String name = source.getName(); int dot = name.lastIndexOf('.');
                target = new File(directory, (dot > 0 ? name.substring(0, dot) : name) + " (" + i + ")" + (dot > 0 ? name.substring(dot) : ""));
            }
            boolean completed = false;
            try {
                try (InputStream in = new FileInputStream(source); OutputStream out = new FileOutputStream(target)) { WorkspaceStorage.copy(in, out); }
                completed = true;
            }
            finally { if (!completed) target.delete(); }
            android.media.MediaScannerConnection.scanFile(activity, new String[]{target.getPath()}, new String[]{WorkspaceStorage.mime(source)}, null);
        }
    }
    // Finish a user-requested save even if the preview is closed while it is copying.
    @Override public void close() { closed = true; worker.shutdown(); }
}
