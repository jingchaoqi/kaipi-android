package dev.kaipi.android;

import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Looper;
import android.view.WindowManager;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.*;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 33})
public class PlatformBehaviorTest {
    private final List<AppUpdates> managers = new ArrayList<>();
    private ActivityController<Activity> controller;
    private Activity host;
    private static Object field(Object object, String name) throws Exception {
        Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(object);
    }
    private static void set(Object object, String name, Object value) throws Exception {
        Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); field.set(object, value);
    }
    private static void idle(AppUpdates manager) throws Exception {
        ((ScheduledExecutorService) field(manager, "worker")).submit(() -> {}).get(10, TimeUnit.SECONDS);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        ((ScheduledExecutorService) field(manager, "worker")).submit(() -> {}).get(10, TimeUnit.SECONDS);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
    }
    private AppUpdates updater(List<JSONObject> events) throws Exception {
        if (host == null) {
            controller = Robolectric.buildActivity(Activity.class).setup(); host = controller.get();
            PackageInfo installed = host.getPackageManager().getPackageInfo(host.getPackageName(), PackageManager.GET_SIGNATURES | PackageManager.GET_PROVIDERS | PackageManager.GET_META_DATA);
            installed.versionName = "0.2.0"; installed.signatures = new Signature[]{new Signature("abcdef")};
            Shadows.shadowOf(host.getPackageManager()).installPackage(installed);
            Shadows.shadowOf(host.getApplication()).grantPermissions(android.Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        AppUpdates result = new AppUpdates(host, events::add); managers.add(result); result.setVisible(true);
        ReleaseInfo info = ReleaseInfo.parse(ReleaseInfoTest.release(ReleaseInfoTest.asset(123)));
        set(result, "release", info);
        return result;
    }
    @After public void cleanup() {
        for (AppUpdates manager : managers) manager.close();
        if (controller != null) controller.pause().stop().destroy();
    }
    @Test public void repeatedRequestsAndActivityRecreationReuseTheDownload() throws Exception {
        List<JSONObject> events = new CopyOnWriteArrayList<>(); AppUpdates manager = updater(events);
        manager.install("123"); idle(manager);
        DownloadManager downloads = (DownloadManager) host.getSystemService(Context.DOWNLOAD_SERVICE);
        ShadowDownloadManager shadow = Shadows.shadowOf(downloads);
        assertEquals(1, shadow.getRequestCount());
        ReleaseInfo info = (ReleaseInfo) field(manager, "release");
        long id = host.getSharedPreferences("app-updates", Context.MODE_PRIVATE).getLong(info.cacheKey(), -1);
        assertTrue(Shadows.shadowOf(shadow.getRequest(id)).getDestination().getPath().endsWith("/Download/" + info.downloadName()));
        manager.install("123"); manager.install("123"); idle(manager);
        assertEquals(1, shadow.getRequestCount());
        manager.close();
        AppUpdates restored = updater(new CopyOnWriteArrayList<>());
        restored.install("123"); idle(restored);
        assertEquals(1, shadow.getRequestCount());
    }
    @Test @Config(sdk = 28) public void backgroundingBeforeStoragePermissionDoesNotLeaveTheActionStuck() throws Exception {
        List<JSONObject> events = new CopyOnWriteArrayList<>(); AppUpdates manager = updater(events);
        Shadows.shadowOf(host.getApplication()).denyPermissions(android.Manifest.permission.WRITE_EXTERNAL_STORAGE);
        manager.setVisible(false); manager.install("123"); idle(manager);
        assertEquals("storage_permission", events.get(events.size() - 1).optString("reason"));
        assertEquals("error", events.get(events.size() - 1).optString("status"));
        manager.setVisible(true); manager.install("123"); idle(manager);
        assertEquals("permission", events.get(events.size() - 1).optString("status"));
    }
    @Test public void completedApkSurvivesDeniedPermissionAndInstallerCancellation() throws Exception {
        List<JSONObject> events = new CopyOnWriteArrayList<>(); AppUpdates manager = updater(events);
        manager.install("123"); idle(manager);
        DownloadManager downloads = (DownloadManager) host.getSystemService(Context.DOWNLOAD_SERVICE);
        ShadowDownloadManager shadow = Shadows.shadowOf(downloads);
        ReleaseInfo info = (ReleaseInfo) field(manager, "release");
        long id = host.getSharedPreferences("app-updates", Context.MODE_PRIVATE).getLong(info.cacheKey(), -1);
        Shadows.shadowOf(shadow.getRequest(id)).setStatus(DownloadManager.STATUS_SUCCESSFUL);
        Uri source = downloads.getUriForDownloadedFile(id);
        assertNotNull(source);
        Shadows.shadowOf(host.getContentResolver()).registerInputStreamSupplier(source, () -> new ByteArrayInputStream(new byte[42]));
        PackageInfo apk = new PackageInfo(); apk.packageName = host.getPackageName(); apk.versionName = "0.3.0";
        apk.versionCode = host.getPackageManager().getPackageInfo(host.getPackageName(), 0).versionCode; apk.signatures = new Signature[]{new Signature("abcdef")};
        Shadows.shadowOf(host.getPackageManager()).setPackageArchiveInfo(new File(host.getCacheDir(), "updates/release.apk").getAbsolutePath(), apk);
        manager.close();
        AppUpdates restored = updater(events);
        restored.install("123"); idle(restored);
        assertEquals(events.toString(), "permission", events.get(events.size() - 1).optString("status"));
        assertEquals(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Shadows.shadowOf(host).getNextStartedActivity().getAction());
        restored.resumed(); idle(restored); // User returns without granting permission.
        assertEquals("ready", events.get(events.size() - 1).getString("status"));
        assertEquals(1, shadow.getRequestCount());
        Shadows.shadowOf(host.getPackageManager()).setCanRequestPackageInstalls(true);
        restored.install("123"); idle(restored);
        Intent install = Shadows.shadowOf(host).getNextStartedActivity();
        assertNotNull(events.toString(), install);
        assertEquals(Intent.ACTION_VIEW, install.getAction());
        assertEquals("content", install.getData().getScheme());
        assertTrue((install.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
        restored.resumed(); idle(restored); // Installation cancelled: reuse the same APK.
        restored.install("123"); idle(restored);
        assertEquals(Intent.ACTION_VIEW, Shadows.shadowOf(host).getNextStartedActivity().getAction());
        assertEquals(1, shadow.getRequestCount());
    }
    @Test public void aReplacementReleaseAssetIsDownloadedWhileTheOldOneIsKept() throws Exception {
        AppUpdates first = updater(new CopyOnWriteArrayList<>());
        first.install("123"); idle(first); first.close();
        AppUpdates next = updater(new CopyOnWriteArrayList<>());
        set(next, "release", ReleaseInfo.parse(ReleaseInfoTest.release(ReleaseInfoTest.asset(124))));
        next.install("124"); idle(next);
        ShadowDownloadManager shadow = Shadows.shadowOf((DownloadManager) host.getSystemService(Context.DOWNLOAD_SERVICE));
        assertEquals(2, shadow.getRequestCount());
    }
    @Test public void aRemovedDownloadIsReplacedInsteadOfOpeningAnInstaller() throws Exception {
        AppUpdates first = updater(new CopyOnWriteArrayList<>());
        first.install("123"); idle(first); first.close();
        DownloadManager downloads = (DownloadManager) host.getSystemService(Context.DOWNLOAD_SERVICE);
        ShadowDownloadManager shadow = Shadows.shadowOf(downloads);
        ReleaseInfo info = (ReleaseInfo) field(first, "release");
        SharedPreferences records = host.getSharedPreferences("app-updates", Context.MODE_PRIVATE);
        long previous = records.getLong(info.cacheKey(), -1);
        DownloadManager.Request oldRequest = shadow.getRequest(previous);
        Shadows.shadowOf(oldRequest).setStatus(DownloadManager.STATUS_SUCCESSFUL);
        ContentProvider missingFile = new MissingDownloadProvider();
        ProviderInfo provider = new ProviderInfo(); provider.authority = "downloads";
        missingFile.attachInfo(host, provider);
        ShadowContentResolver.registerProviderInternal("downloads", missingFile);
        assertThrows(FileNotFoundException.class, () -> host.getContentResolver().openInputStream(downloads.getUriForDownloadedFile(previous)));
        AppUpdates next = updater(new CopyOnWriteArrayList<>());
        next.install("123"); idle(next);
        assertNotSame(oldRequest, shadow.getRequest(records.getLong(info.cacheKey(), -1)));
        assertEquals(1, shadow.getRequestCount());
        assertNull(Shadows.shadowOf(host).getNextStartedActivity());
    }
    @Test public void corruptedDownloadIsRejectedAndCanBeDownloadedAgain() throws Exception {
        List<JSONObject> events = new CopyOnWriteArrayList<>(); AppUpdates first = updater(events);
        ReleaseInfo info = ReleaseInfo.parse(ReleaseInfoTest.release(ReleaseInfoTest.asset(123).put("digest", "sha256:" + "0".repeat(64))));
        set(first, "release", info);
        first.install("123"); idle(first); first.close();
        DownloadManager downloads = (DownloadManager) host.getSystemService(Context.DOWNLOAD_SERVICE);
        ShadowDownloadManager shadow = Shadows.shadowOf(downloads);
        long id = host.getSharedPreferences("app-updates", Context.MODE_PRIVATE).getLong(info.cacheKey(), -1);
        Shadows.shadowOf(shadow.getRequest(id)).setStatus(DownloadManager.STATUS_SUCCESSFUL);
        Shadows.shadowOf(host.getContentResolver()).registerInputStreamSupplier(downloads.getUriForDownloadedFile(id), () -> new ByteArrayInputStream(new byte[42]));
        AppUpdates next = updater(events); set(next, "release", info);
        next.install("123"); idle(next);
        assertEquals("verification_failed", events.get(events.size() - 1).optString("reason"));
        assertEquals(0, shadow.getRequestCount());
        assertNull(Shadows.shadowOf(host).getNextStartedActivity());
        next.install("123"); idle(next); assertEquals(1, shadow.getRequestCount());
    }
    @Test public void screenAwakeTracksEveryWorkspaceAndReleasesInBackground() throws Exception {
        ActivityController<MainActivity> app = Robolectric.buildActivity(MainActivity.class).setup();
        try {
            MainActivity activity = app.get();
            @SuppressWarnings("unchecked") Map<String, LocalCore> engines = (Map<String, LocalCore>) field(activity, "engines");
            LocalCore first = new LocalCore(new LocalCore.Listener() {
                public void message(String json) {} public void failed(String reason) {} public void activityChanged() {}
            });
            engines.put("background-workspace", first);
            TurnActivity running = (TurnActivity) field(first, "activity");
            Method refresh = MainActivity.class.getDeclaredMethod("updateScreenAwake"); refresh.setAccessible(true);
            assertFalse(awake(activity));
            running.requested("1"); refresh.invoke(activity); assertTrue(awake(activity));
            running.response("1", true); app.pause().stop(); assertFalse(awake(activity));
            app.start().resume(); assertTrue(awake(activity));
            running.settled(false); refresh.invoke(activity); assertFalse(awake(activity));
        } finally { app.pause().stop().destroy(); }
    }
    private static boolean awake(Activity activity) {
        return (activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0;
    }
    @Test @Config(sdk = 33) public void menuGestureExcludesOnlyTheEnabledUpperLeftRegion() throws Exception {
        ActivityController<MainActivity> app = Robolectric.buildActivity(MainActivity.class).setup();
        try {
            MainActivity activity = app.get();
            MainActivity.Bridge bridge = activity.new Bridge();
            bridge.menuGesture(true); Shadows.shadowOf(Looper.getMainLooper()).idle();
            assertEquals(true, field(activity, "menuGesture"));
            // Robolectric's WebView has no renderer/layout. Exercise the inherited View API.
            android.view.View surface = new android.view.View(activity);
            float density = activity.getResources().getDisplayMetrics().density;
            surface.layout(0, 0, Math.round(390 * density), Math.round(844 * density));
            MainActivity.updateMenuGestureExclusion(surface, true);
            List<android.graphics.Rect> regions = surface.getSystemGestureExclusionRects();
            assertEquals(1, regions.size());
            android.graphics.Rect region = regions.get(0);
            assertEquals(0, region.left); assertEquals(0, region.top);
            assertEquals(Math.round(72 * density), region.width());
            assertEquals(Math.round(200 * density), region.height());
            surface.layout(0, 0, Math.round(390 * density), Math.round(500 * density));
            MainActivity.updateMenuGestureExclusion(surface, true);
            assertEquals(Math.round(200 * density), surface.getSystemGestureExclusionRects().get(0).height());
            surface.layout(0, 0, Math.round(50 * density), Math.round(150 * density));
            MainActivity.updateMenuGestureExclusion(surface, true);
            assertEquals(surface.getWidth(), surface.getSystemGestureExclusionRects().get(0).width());
            assertEquals(surface.getHeight(), surface.getSystemGestureExclusionRects().get(0).height());
            bridge.menuGesture(false); Shadows.shadowOf(Looper.getMainLooper()).idle();
            assertEquals(false, field(activity, "menuGesture"));
            MainActivity.updateMenuGestureExclusion(surface, false);
            assertTrue(surface.getSystemGestureExclusionRects().isEmpty());
            surface.layout(0, 0, Math.round(1024 * density), Math.round(844 * density));
            MainActivity.updateMenuGestureExclusion(surface, true);
            assertTrue(surface.getSystemGestureExclusionRects().isEmpty());
        } finally { app.pause().stop().destroy(); }
    }
    public static class MissingDownloadProvider extends ContentProvider {
        public boolean onCreate() { return true; }
        public android.database.Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { return null; }
        public String getType(Uri uri) { return "application/vnd.android.package-archive"; }
        public Uri insert(Uri uri, ContentValues values) { return null; }
        public int delete(Uri uri, String selection, String[] args) { return 0; }
        public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
        public android.os.ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException { throw new FileNotFoundException("removed"); }
    }
    @Test public void coreCompletionFailureAndCancellationAreAllTerminal() throws Exception {
        for (String terminal : new String[]{"completed", "aborted", "error"}) {
            List<Boolean> observed = new ArrayList<>(); LocalCore[] engine = new LocalCore[1];
            engine[0] = new LocalCore(new LocalCore.Listener() {
                public void message(String json) { observed.add(engine[0].isRunning()); }
                public void failed(String reason) {} public void activityChanged() {}
            });
            String lines = "{\"event\":\"turn\",\"data\":{\"kind\":\"start\"}}\n{\"event\":\"turn\",\"data\":{\"kind\":\"" + terminal + "\"}}\n";
            Process process = new Process() {
                public InputStream getInputStream() { return new ByteArrayInputStream(lines.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
                public InputStream getErrorStream() { return InputStream.nullInputStream(); }
                public OutputStream getOutputStream() { return OutputStream.nullOutputStream(); }
                public int waitFor() { return 0; } public int exitValue() { return 0; } public void destroy() {}
            };
            Method read = LocalCore.class.getDeclaredMethod("read", Process.class); read.setAccessible(true); read.invoke(engine[0], process);
            assertEquals(Arrays.asList(true, false), observed);
            engine[0].close();
        }
    }
}
