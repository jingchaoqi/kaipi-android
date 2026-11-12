package dev.kaipi.android;

import android.app.Activity;
import android.content.*;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

/** Generated documents run in their own WebView, with no JavascriptInterface. */
public final class FilePreviewActivity extends Activity {
    static final String ORIGIN = "https://preview.kaipi.invalid";
    private WebView web;
    private WorkspaceFiles delivery;
    private boolean english;
    private int ink, surface, accent;
    private String workspace, path;
    private TextView status, saveButton;
    private boolean visible, running;
    private final java.util.function.Consumer<Boolean> conversationActivity = value -> { running = value; updateScreenAwake(); };
    private void updateScreenAwake() {
        if (visible && running) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private int color(JSONObject appearance, String key, String fallback) {
        String value = appearance.optString(key, fallback);
        return Color.parseColor(value.matches("#[0-9a-fA-F]{6}") ? value : fallback);
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ConversationActivity.observe(conversationActivity);
        JSONObject appearance;
        try { appearance = new JSONObject(getIntent().getStringExtra("appearance")); } catch (Exception error) { appearance = new JSONObject(); }
        english = appearance.optString("language").equals("en");
        int background = color(appearance, "background", "#f8f9f6");
        ink = color(appearance, "ink", "#222d27"); surface = color(appearance, "surface", "#e9efe6"); accent = color(appearance, "accent", "#365d47");
        getWindow().setStatusBarColor(background); getWindow().setNavigationBarColor(background);
        if (!appearance.optBoolean("dark")) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (android.os.Build.VERSION.SDK_INT >= 27 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0));
        workspace = getIntent().getStringExtra("workspace"); path = getIntent().getStringExtra("path");
        LinearLayout page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setBackgroundColor(background);
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setPadding(dp(10), dp(8), dp(12), dp(8));
        bar.addView(button("‹", english ? "Back" : "返回", this::finish));
        LinearLayout labels = new LinearLayout(this); labels.setOrientation(LinearLayout.VERTICAL); labels.setPadding(dp(8), 0, dp(8), 0);
        TextView title = new TextView(this); title.setText(path == null ? "" : new File(path).getName()); title.setTextSize(14); title.setTextColor(ink); title.setSingleLine(); title.setEllipsize(TextUtils.TruncateAt.MIDDLE); title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        TextView subtitle = new TextView(this); subtitle.setText(english ? "Local preview" : "本地预览"); subtitle.setTextSize(11); subtitle.setTextColor(accent); subtitle.setPadding(0, dp(4), 0, 0);
        labels.addView(title); labels.addView(subtitle); bar.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
        saveButton = button(english ? "Save" : "保存", english ? "Save to Downloads" : "保存到 Downloads", () -> delivery.save(workspace, path));
        bar.addView(saveButton);
        bar.addView(button(english ? "Share" : "分享", english ? "Share file" : "分享文件", () -> delivery.share(workspace, path)));
        page.addView(bar, new LinearLayout.LayoutParams(-1, dp(64)));
        status = new TextView(this); status.setTextSize(11); status.setTextColor(accent); status.setGravity(Gravity.CENTER); status.setSingleLine(); status.setEllipsize(TextUtils.TruncateAt.END);
        delivery = new WorkspaceFiles(this, event -> {
            String value = event.optString("status");
            boolean saving = value.equals("saving");
            saveButton.setEnabled(!saving); saveButton.setAlpha(saving ? .55f : 1f);
            saveButton.setText(saving ? (english ? "Saving…" : "保存中…") : (english ? "Save" : "保存"));
            String message = saving ? (english ? "Saving…" : "正在保存文件…")
                : value.equals("saved") ? (english ? "Saved to " : "已保存到 ") + event.optString("location", "Downloads/kaipi")
                : (english ? "Unable to complete. Check the file, storage and permissions." : event.optString("data"));
            status.setText(message);
            if (value.equals("saved") || value.equals("error")) Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        });
        web = new WebView(this); web.setBackgroundColor(background);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setSupportMultipleWindows(false);
        web.getSettings().setBuiltInZoomControls(true); web.getSettings().setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        page.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        page.addView(status, new LinearLayout.LayoutParams(-1, dp(28))); setContentView(page);
        try {
            File root = WorkspaceStorage.root(this, workspace), file = WorkspaceStorage.resolve(root, path);
            if (!file.isFile()) throw new IOException();
            web.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return resource(root, request.getUrl()); }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if ("https".equals(uri.getScheme()) && "preview.kaipi.invalid".equals(uri.getAuthority())) return false;
                    if (request.isForMainFrame() && request.hasGesture() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) && !"preview.kaipi.invalid".equals(uri.getHost())) {
                        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException ignored) { }
                    }
                    return true;
                }
            });
            String url = url(WorkspaceStorage.relative(root, file));
            if (WorkspaceStorage.mime(file).equals("text/html")) web.loadUrl(url);
            else {
                String body;
                if (WorkspaceStorage.mime(file).startsWith("image/")) body = "<img style='max-width:100%;height:auto' src='" + html(url) + "'>";
                else {
                    if (file.length() > 2 * 1024 * 1024) throw new IOException();
                    body = "<pre style='white-space:pre-wrap;overflow-wrap:anywhere'>" + html(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)) + "</pre>";
                }
                web.loadDataWithBaseURL(ORIGIN + "/", "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src " + ORIGIN + "; style-src 'unsafe-inline'\"><body style='margin:20px;background:" + String.format(Locale.ROOT,"#%06x", background & 0xffffff) + ";color:" + String.format(Locale.ROOT,"#%06x", ink & 0xffffff) + "'>" + body, "text/html", "UTF-8", null);
            }
        } catch (Exception error) { status.setText(english ? "Preview unavailable. You can save or share the file." : "暂时无法预览，可保存或分享文件后打开。"); }
    }
    private TextView button(String label, String description, Runnable action) {
        TextView button = new TextView(this); button.setText(label); button.setContentDescription(description); button.setTextSize(13); button.setTextColor(accent); button.setGravity(Gravity.CENTER); button.setPadding(dp(12), 0, dp(12), 0);
        GradientDrawable background = new GradientDrawable(); background.setColor(surface); background.setCornerRadius(dp(14));
        GradientDrawable mask = new GradientDrawable(); mask.setColor(Color.WHITE); mask.setCornerRadius(dp(14));
        button.setBackground(new RippleDrawable(ColorStateList.valueOf((accent & 0xffffff) | 0x28000000), background, mask));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(40)); params.setMargins(dp(4), 0, 0, 0); button.setLayoutParams(params);
        button.setOnClickListener(view -> {
            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK);
            action.run();
        }); button.setFocusable(true); return button;
    }
    static String url(String path) {
        Uri.Builder builder = Uri.parse(ORIGIN).buildUpon().appendPath("files");
        for (String part : path.split("/")) builder.appendPath(part);
        return builder.build().toString();
    }
    static WebResourceResponse resource(File root, Uri uri) {
        try {
            if (!"https".equals(uri.getScheme()) || !"preview.kaipi.invalid".equals(uri.getAuthority()) || uri.getPath() == null || !uri.getPath().startsWith("/files/")) throw new IOException();
            File file = WorkspaceStorage.resolve(root, uri.getPath().substring(7));
            if (!file.isFile()) throw new IOException();
            WebResourceResponse response = new WebResourceResponse(WorkspaceStorage.mime(file), "UTF-8", new FileInputStream(file));
            Map<String, String> headers = new HashMap<>(); headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; worker-src 'none'");
            response.setResponseHeaders(headers); return response;
        } catch (Exception error) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
    }
    private static String html(String value) { return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;"); }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == WorkspaceFiles.STORAGE_PERMISSION) delivery.permissionResult(results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
    }
    @Override protected void onStart() { super.onStart(); visible = true; updateScreenAwake(); }
    @Override protected void onStop() { visible = false; updateScreenAwake(); super.onStop(); }
    @Override protected void onDestroy() { ConversationActivity.remove(conversationActivity); if (delivery != null) delivery.close(); if (web != null) web.destroy(); super.onDestroy(); }
}
