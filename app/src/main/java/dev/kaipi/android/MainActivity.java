package dev.kaipi.android;

import android.app.Activity;
import android.content.*;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Platform shell: local assets, core process, system file picker and clipboard. */
public final class MainActivity extends Activity {
    private WebView web;
    private volatile LocalCore core;
    private boolean destroyed, visible, screenAwake, menuGesture;
    private int generation;
    private String workspace;
    private SharedPreferences prefs;
    private AppUpdates updates;
    private WorkspaceFiles workspaceFiles;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private final Map<String, LocalCore> engines = new HashMap<>();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        updates = new AppUpdates(this, stateValue -> platformEvent("update", stateValue));
        workspaceFiles = new WorkspaceFiles(this, value -> platformEvent("workspaceFiles", value));
        prefs = getSharedPreferences("tabs", MODE_PRIVATE);
        workspace = prefs.getString("active", "");
        try { UUID.fromString(workspace); } catch (IllegalArgumentException error) { workspace = UUID.randomUUID().toString(); }
        prefs.edit().putString("active", workspace).apply();
        web = new WebView(this);
        web.setBackgroundColor(0xfff8f9f6);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
            WebView.setWebContentsDebuggingEnabled(true);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String prefix = "https://app.kaipi.invalid/", url = request.getUrl().toString();
                if (url.startsWith(prefix)) {
                    String path = url.substring(prefix.length());
                    if (!path.contains("..") && !path.contains("%") && !path.contains("?")) try {
                        String mime = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".woff2") ? "font/woff2" : path.endsWith(".svg") ? "image/svg+xml" : "text/html";
                        WebResourceResponse response = new WebResourceResponse(mime, "UTF-8", getAssets().open("ui/" + path));
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Cache-Control", "no-store");
                        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'");
                        response.setResponseHeaders(headers); return response;
                    } catch (IOException ignored) { }
                }
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
        });
        setContentView(web);
        web.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> updateMenuGestureExclusion(web, menuGesture));
        web.loadUrl("https://app.kaipi.invalid/index.html");
    }
    static void updateMenuGestureExclusion(android.view.View surface, boolean enabled) {
        if (android.os.Build.VERSION.SDK_INT < 29) return;
        float density = surface.getResources().getDisplayMetrics().density;
        List<android.graphics.Rect> regions = new ArrayList<>();
        if (enabled && surface.getWidth() > 0 && surface.getWidth() / density <= 800) {
            // Android allows at most 200 dp of exclusion per edge. Keep the rest for Back.
            int height = Math.min(surface.getHeight(), Math.round(200 * density));
            if (height > 0) regions.add(new android.graphics.Rect(0, 0, Math.min(surface.getWidth(), Math.round(72 * density)), height));
        }
        surface.setSystemGestureExclusionRects(regions);
    }
    private void updateScreenAwake() {
        boolean running = !destroyed && engines.values().stream().anyMatch(LocalCore::isRunning);
        ConversationActivity.update(running);
        boolean awake = visible && running;
        if (awake == screenAwake) return;
        screenAwake = awake;
        if (awake) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @Override protected void onStart() { super.onStart(); visible = true; updates.setVisible(true); updateScreenAwake(); }
    @Override protected void onStop() { visible = false; updates.setVisible(false); updateScreenAwake(); super.onStop(); }
    @Override protected void onResume() { super.onResume(); updates.resumed(); }
    private void deliver(String json) {
        runOnUiThread(() -> { if (!destroyed) web.evaluateJavascript("window.kaipi.receive(" + JSONObject.quote(json) + ")", null); });
    }
    private void platformEvent(String event, Object data) {
        try { deliver(new JSONObject().put("event", event).put("data", data).toString()); }
        catch (JSONException error) { throw new IllegalStateException(error); }
    }
    private void connect(String id) {
        workspace = id;
        prefs.edit().putString("active", id).apply();
        generation++;
        LocalCore existing = engines.get(id);
        if (existing != null) { core = existing; core.send("{\"id\":\"reconnect\",\"op\":\"state\"}"); return; }
        LocalCore engine = new LocalCore(new LocalCore.Listener() {
            public void activityChanged() { runOnUiThread(() -> { if (!destroyed) updateScreenAwake(); }); }
            public void message(String json) { runOnUiThread(() -> { if (!destroyed && workspace.equals(id)) deliver(json); }); }
            public void failed(String message) { runOnUiThread(() -> { if (!destroyed && workspace.equals(id)) platformEvent("disconnected", message); }); }
        });
        engines.put(id, engine); core = engine; updateScreenAwake();
        engine.start(getApplicationContext(), new File(getFilesDir(), "workspaces/" + id));
    }
    public final class Bridge {
        @JavascriptInterface public void listWorkspaceFiles(String request, String path) { runOnUiThread(() -> workspaceFiles.list(workspace, request, path)); }
        @JavascriptInterface public void openWorkspaceFile(String path, String appearance) { runOnUiThread(() -> workspaceFiles.open(workspace, path, appearance)); }
        @JavascriptInterface public void saveWorkspaceFile(String path) { runOnUiThread(() -> workspaceFiles.save(workspace, path)); }
        @JavascriptInterface public void shareWorkspaceFile(String path) { runOnUiThread(() -> workspaceFiles.share(workspace, path)); }
        @JavascriptInterface public void menuGesture(boolean enabled) { runOnUiThread(() -> {
            if (destroyed) return;
            menuGesture = enabled; updateMenuGestureExclusion(web, menuGesture);
        }); }
        @JavascriptInterface public void checkUpdates() { updates.check(); }
        @JavascriptInterface public void installUpdate(String asset) { updates.install(asset); }
        @JavascriptInterface public void ready() { runOnUiThread(() -> connect(workspace)); }
        @JavascriptInterface public void request(String json) {
            if (json.length() > 56 * 1024 * 1024) return;
            LocalCore target = core; if (target != null) target.send(json);
        }
        @JavascriptInterface public void retry() { runOnUiThread(() -> {
            LocalCore old = engines.remove(workspace); if (old != null) old.close();
            String target = workspace;
            files.execute(() -> {
                if (old != null) old.awaitClosed();
                runOnUiThread(() -> { if (!destroyed && target.equals(workspace)) connect(target); });
            });
        }); }
        @JavascriptInterface public void appearance(String background, boolean dark) {
            if (!background.matches("#[0-9a-fA-F]{6}")) return;
            runOnUiThread(() -> {
                if (destroyed) return;
                int color = android.graphics.Color.parseColor(background);
                web.setBackgroundColor(color);
                getWindow().setStatusBarColor(color);
                getWindow().setNavigationBarColor(android.os.Build.VERSION.SDK_INT >= 27 || dark ? color : 0xff243027);
                int flags = getWindow().getDecorView().getSystemUiVisibility();
                int light = android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (android.os.Build.VERSION.SDK_INT >= 27) light |= android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                getWindow().getDecorView().setSystemUiVisibility(dark ? flags & ~light : flags | light);
            });
        }
        @JavascriptInterface public void copy(String text) {
            ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("kaipi", text));
        }
        @JavascriptInterface public void pickFile() { runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            startActivityForResult(intent, 10);
        }); }
        @JavascriptInterface public void workspaces() { runOnUiThread(() -> {
            JSONArray result = new JSONArray();
            try {
                JSONArray legacy = new JSONArray(prefs.getString("list", "[]"));
                Set<String> seen = new HashSet<>();
                for (int i = 0; i < legacy.length(); i++) {
                    JSONObject item = legacy.getJSONObject(i); UUID.fromString(item.getString("id"));
                    seen.add(item.getString("id")); result.put(item);
                }
                if (!seen.contains(workspace)) result.put(new JSONObject().put("id", workspace).put("name", "默认工作区").put("is_default", true));
            } catch (JSONException | IllegalArgumentException ignored) { }
            platformEvent("workspaces", result);
        }); }
        @JavascriptInterface public void workspace(String id) { runOnUiThread(() -> {
            try { UUID.fromString(id); connect(id); } catch (IllegalArgumentException ignored) { }
        }); }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == AppUpdates.STORAGE_PERMISSION) updates.storageResult(results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
        if (request == WorkspaceFiles.STORAGE_PERMISSION) workspaceFiles.permissionResult(results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
    }
    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request != 10 || result != RESULT_OK || intent == null) return;
        List<Uri> uris = new ArrayList<>();
        if (intent.getClipData() != null) {
            if (intent.getClipData().getItemCount() > 8) { platformEvent("fileError", "每条消息最多添加 8 个附件。"); return; }
            for (int i = 0; i < intent.getClipData().getItemCount(); i++) uris.add(intent.getClipData().getItemAt(i).getUri());
        }
        else if (intent.getData() != null) uris.add(intent.getData());
        int selected = generation;
        files.execute(() -> {
            JSONArray resultFiles = new JSONArray();
            try {
                long total = 0;
                for (Uri uri : uris) {
                    String name = "附件";
                    try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                    }
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new IOException("文件不可读");
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buffer = new byte[16384]; int count;
                        while ((count = in.read(buffer)) != -1) {
                            total += count;
                            if (out.size() + count > 20 * 1024 * 1024 || total > 40 * 1024 * 1024) throw new IOException("附件过大：单个最多 20 MiB，合计最多 40 MiB");
                            out.write(buffer, 0, count);
                        }
                        resultFiles.put(new JSONObject().put("name", name).put("data", android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)));
                    }
                }
                runOnUiThread(() -> { if (!destroyed && generation == selected) platformEvent("files", resultFiles); });
            } catch (Exception error) { runOnUiThread(() -> { if (!destroyed && generation == selected) platformEvent("fileError", "无法读取附件，或文件超过大小限制。"); }); }
        });
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.kaipi.back()", result -> { if ("false".equals(result)) finish(); });
    }
    @Override protected void onDestroy() {
        destroyed = true; updateScreenAwake(); updates.close(); workspaceFiles.close(); files.shutdownNow();
        for (LocalCore engine : engines.values()) engine.close();
        web.removeJavascriptInterface("Native"); web.destroy();
        super.onDestroy();
    }
}
