package dev.kaipi.android;

import android.app.Activity;
import android.content.*;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.webkit.WebResourceResponse;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.ZipFile;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 33})
public class WorkspaceFilesTest {
    private ActivityController<Activity> controller;
    private Activity host;
    private WorkspaceFiles delivery;
    private File root;
    private String workspace;
    private final List<JSONObject> events = new CopyOnWriteArrayList<>();
    private Downloads downloads;
    @Before public void setup() throws Exception {
        controller = Robolectric.buildActivity(Activity.class).setup(); host = controller.get();
        ConversationActivity.update(false);
        workspace = UUID.randomUUID().toString(); root = WorkspaceStorage.root(host, workspace); assertTrue(root.mkdirs());
        delivery = new WorkspaceFiles(host, events::add);
        // Match the provider lifecycle; Robolectric gives each test a new app files directory.
        WorkspaceFileProvider provider = new WorkspaceFileProvider();
        provider.attachInfo(host, host.getPackageManager().resolveContentProvider(host.getPackageName()+".files", android.content.pm.PackageManager.GET_META_DATA));
        ShadowContentResolver.registerProviderInternal(host.getPackageName()+".files", provider);
        Shadows.shadowOf(host.getApplication()).grantPermissions(android.Manifest.permission.WRITE_EXTERNAL_STORAGE);
        if (Build.VERSION.SDK_INT >= 29) {
            downloads = new Downloads(); ProviderInfo info = new ProviderInfo(); info.authority = "media";
            downloads.attachInfo(host, info); ShadowContentResolver.registerProviderInternal("media", downloads);
        }
    }
    @After public void cleanup() { delivery.close(); controller.pause().stop().destroy(); }
    private File file(String path, String content) throws Exception {
        File file = new File(root, path); file.getParentFile().mkdirs(); Files.write(file.toPath(), content.getBytes(StandardCharsets.UTF_8)); return file;
    }
    private String read(File file) throws IOException { return new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8); }
    private void idle() throws Exception {
        Field worker = WorkspaceFiles.class.getDeclaredField("worker"); worker.setAccessible(true);
        ((ExecutorService)worker.get(delivery)).submit(() -> {}).get(10, TimeUnit.SECONDS);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
    }
    @Test public void existingFilesAreBrowsableWithoutStartingOrChangingCore() throws Exception {
        file("设计稿.html", "<h1>Hello</h1>"); file("project/styles.css", "body{}");
        file(".kaipi/sessions/old.jsonl", "frozen log"); file(".git/config", "private metadata");
        delivery.list(workspace, "7", ""); idle();
        JSONObject result = events.get(0); assertEquals("listed", result.getString("status")); assertEquals("7", result.getString("request"));
        JSONArray entries = result.getJSONObject("data").getJSONArray("entries");
        assertEquals(2, entries.length()); assertEquals("project", entries.getJSONObject(0).getString("name"));
        assertEquals("设计稿.html", entries.getJSONObject(1).getString("name"));
        assertEquals("frozen log", read(new File(root,".kaipi/sessions/old.jsonl")));
    }
    @Test public void traversalSymlinksAndCoreMetadataCannotBePublished() throws Exception {
        File secret = new File(host.getFilesDir(), "home/key.json"); secret.getParentFile().mkdirs(); Files.write(secret.toPath(), "SECRET".getBytes(StandardCharsets.UTF_8));
        file(".kaipi/log.jsonl", "internal"); file(".git/config", "internal"); file("safe.txt", "user file");
        Files.createSymbolicLink(new File(root, "outside.txt").toPath(), secret.toPath());
        for (String path : new String[]{"../../home/key.json",secret.getPath(),"outside.txt",".kaipi/log.jsonl",".git/config","file://other/safe.txt"})
            assertThrows(path, IOException.class, () -> WorkspaceStorage.resolve(root, path));
        assertEquals(1, WorkspaceStorage.list(root, "").getJSONArray("entries").length());
        assertEquals(new File(root,"safe.txt"), WorkspaceStorage.resolve(root, Uri.fromFile(new File(root,"safe.txt")).toString()));
    }
    @Test public void confirmedDeletionRemovesOnlyTheSelectedFileAndReportsItsRequest() throws Exception {
        File selected=file("设计稿 100% #1.html","deliverable"),keep=file("keep.txt","keep");
        File log=file(".kaipi/sessions/log.jsonl","history");
        delivery.list(workspace,"list","");idle();
        JSONObject listed=events.get(0).getJSONObject("data");assertEquals(workspace,listed.getString("workspace"));
        String revision=WorkspaceStorage.deletionRevision(root,selected.getName());assertTrue(revision.matches("[0-9a-f]{64}"));
        assertTrue(listed.getJSONArray("entries").toString().contains(revision));
        delivery.delete(workspace,"confirm-1",selected.getName(),revision);idle();
        JSONObject result=events.get(events.size()-1);assertEquals("deleted",result.getString("status"));assertEquals("confirm-1",result.getString("request"));
        assertFalse(selected.exists());assertEquals("keep",read(keep));assertEquals("history",read(log));
    }
    @Test public void changedFilesAndRevisionsFromAnotherWorkspaceAreNotDeleted() throws Exception {
        File selected=file("notes.txt","original");String revision=WorkspaceStorage.deletionRevision(root,"notes.txt");
        Files.write(selected.toPath(),"changed contents".getBytes(StandardCharsets.UTF_8));
        delivery.delete(workspace,"stale","notes.txt",revision);idle();
        assertEquals("delete_error",events.get(events.size()-1).optString("status"));assertEquals("changed contents",read(selected));
        File other=WorkspaceStorage.root(host,UUID.randomUUID().toString());assertTrue(other.mkdirs());
        File sameName=new File(other,"notes.txt");Files.write(sameName.toPath(),"original".getBytes(StandardCharsets.UTF_8));
        assertThrows(IOException.class,()->WorkspaceStorage.deleteFile(other,"notes.txt",revision));assertTrue(sameName.exists());
    }
    @Test public void deletionRejectsDirectoriesInternalPathsAndReplacedSymlinks() throws Exception {
        File selected=file("selected.txt","original");String revision=WorkspaceStorage.deletionRevision(root,"selected.txt");
        Files.move(selected.toPath(),new File(root,"moved.txt").toPath());
        Files.createSymbolicLink(selected.toPath(),new File(root,"moved.txt").toPath());
        assertThrows(IOException.class,()->WorkspaceStorage.deleteFile(root,"selected.txt",revision));assertTrue(new File(root,"moved.txt").exists());
        file("folder/keep.txt","keep");file(".git/config","git");file(".kaipi/log.jsonl","history");
        for(String path:new String[]{"","folder",".git/config",".kaipi/log.jsonl","../home/key.json",new File(root,"moved.txt").getPath()})
            assertThrows(path,IOException.class,()->WorkspaceStorage.deleteFile(root,path,revision));
        String nested=WorkspaceStorage.deletionRevision(root,"folder/keep.txt");
        Files.move(new File(root,"folder").toPath(),new File(root,"renamed-folder").toPath());
        Files.createSymbolicLink(new File(root,"folder").toPath(),new File(root,"renamed-folder").toPath());
        assertThrows(IOException.class,()->WorkspaceStorage.deleteFile(root,"folder/keep.txt",nested));assertTrue(new File(root,"renamed-folder/keep.txt").exists());
    }
    @Test public void workspaceRootCannotBeReplacedWithALinkToPrivateHome() throws Exception {
        File home=new File(host.getFilesDir(),"home");home.mkdirs();String id=UUID.randomUUID().toString();
        Files.createSymbolicLink(new File(root.getParentFile(),id).toPath(),home.toPath());
        assertThrows(IOException.class,()->WorkspaceStorage.root(host,id));
    }
    @Test public void bridgeRejectsDeletionAfterTheWorkspaceChanges() throws Exception {
        ActivityController<MainActivity> app=Robolectric.buildActivity(MainActivity.class).setup();
        try {
            MainActivity main=app.get();Field active=MainActivity.class.getDeclaredField("workspace");active.setAccessible(true);
            File current=WorkspaceStorage.root(main,(String)active.get(main));current.mkdirs();
            File selected=new File(current,"keep.txt");Files.write(selected.toPath(),"keep".getBytes(StandardCharsets.UTF_8));
            main.new Bridge().deleteWorkspaceFile(UUID.randomUUID().toString(),"old-workspace","keep.txt",WorkspaceStorage.deletionRevision(current,"keep.txt"));
            Shadows.shadowOf(Looper.getMainLooper()).idle();assertEquals("keep",read(selected));
            Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);
            assertTrue(Shadows.shadowOf((android.webkit.WebView)field.get(main)).getLastEvaluatedJavascript().contains("delete_error"));
        } finally {app.pause().stop().destroy();}
    }
    @Test public void anExpiredQueuedDeleteNeverRemovesTheFileLater() throws Exception {
        File selected=file("queued.txt","keep");String revision=WorkspaceStorage.deletionRevision(root,"queued.txt");
        Field field=WorkspaceFiles.class.getDeclaredField("worker");field.setAccessible(true);
        ExecutorService worker=(ExecutorService)field.get(delivery);
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        worker.submit(()->{entered.countDown();try{release.await(10,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}});
        assertTrue(entered.await(5,TimeUnit.SECONDS));
        try {
            delivery.delete(workspace,"expired","queued.txt",revision);
            org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofSeconds(16));
        } finally {release.countDown();}
        idle();assertEquals("keep",read(selected));assertEquals("delete_error",events.get(events.size()-1).optString("status"));
    }
    @Test public void folderArchivePreservesResourcesAndOmitsInternalDataAndLinks() throws Exception {
        file("index.html", "<link href='./assets/style.css'>"); file("assets/style.css", "body{color:red}");
        file("assets/中文.txt", "你好"); file(".kaipi/sessions/log", "INTERNAL"); file(".git/config", "INTERNAL");
        Files.createSymbolicLink(new File(root,"assets/loop").toPath(), root.toPath());
        File destination = new File(host.getCacheDir(), "delivery.zip"); WorkspaceStorage.zip(root, root, destination);
        try (ZipFile zip = new ZipFile(destination)) {
            assertEquals("body{color:red}", new String(zip.getInputStream(zip.getEntry("assets/style.css")).readAllBytes(),StandardCharsets.UTF_8));
            assertEquals("你好", new String(zip.getInputStream(zip.getEntry("assets/中文.txt")).readAllBytes(),StandardCharsets.UTF_8));
            assertNotNull(zip.getEntry("index.html")); assertNull(zip.getEntry("assets/loop"));
            assertFalse(zip.stream().anyMatch(entry -> entry.getName().contains(".kaipi") || entry.getName().contains(".git")));
        }
    }
    @Test public void previewResourcesUseTheirOwnOriginAndBlockPrivateAndNetworkAccess() throws Exception {
        file("demo/index.html", "<button onclick='this.textContent=42'>Click</button>"); file("demo/app.js", "window.active=true");
        file(".kaipi/log", "PRIVATE");
        WebResourceResponse html = FilePreviewActivity.resource(root, Uri.parse(FilePreviewActivity.url("demo/index.html")));
        assertEquals("text/html", html.getMimeType()); assertTrue(new String(html.getData().readAllBytes(),StandardCharsets.UTF_8).contains("onclick")); html.getData().close();
        assertTrue(html.getResponseHeaders().get("Content-Security-Policy").contains("connect-src 'none'"));
        for (String url : new String[]{"https://app.kaipi.invalid/index.html", "https://example.com/tracker", "file:///etc/passwd", "https://preview.kaipi.invalid/files/../../home/key.json", "https://preview.kaipi.invalid/files/%2e%2ekaipi", "https://preview.kaipi.invalid/files/.kaipi/log"})
            assertEquals(url, 404, FilePreviewActivity.resource(root, Uri.parse(url)).getStatusCode());
        WebResourceResponse script = FilePreviewActivity.resource(root, Uri.parse(FilePreviewActivity.url("demo/app.js")));
        assertTrue(script.getMimeType().contains("javascript")); script.getData().close();
    }
    @Test public void interactivePreviewHasNoAppBridgeOrLocalFileAccess() throws Exception {
        file("index.html","<script>window.test=1</script>");
        Intent intent=new Intent(host,FilePreviewActivity.class).putExtra("workspace",workspace).putExtra("path","index.html").putExtra("appearance","{\"language\":\"en\",\"dark\":true}");
        ActivityController<FilePreviewActivity> preview=Robolectric.buildActivity(FilePreviewActivity.class,intent).setup();
        try {
            Field field=FilePreviewActivity.class.getDeclaredField("web");field.setAccessible(true);
            android.webkit.WebView web=(android.webkit.WebView)field.get(preview.get());
            assertTrue(web.getSettings().getJavaScriptEnabled());assertFalse(web.getSettings().getAllowFileAccess());assertFalse(web.getSettings().getAllowContentAccess());
            assertNull(Shadows.shadowOf(web).getJavascriptInterface("Native"));
            assertEquals(FilePreviewActivity.url("index.html"),Shadows.shadowOf(web).getLastLoadedUrl());
        } finally {preview.pause().stop().destroy();}
    }
    @Test public void previewKeepsTheScreenAwakeOnlyForAnActiveForegroundConversation() throws Exception {
        file("index.html","<h1>Preview</h1>");
        Intent intent=new Intent(host,FilePreviewActivity.class).putExtra("workspace",workspace).putExtra("path","index.html").putExtra("appearance","{}");
        ActivityController<FilePreviewActivity> preview=Robolectric.buildActivity(FilePreviewActivity.class,intent).setup();
        int flag=android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
        try {
            ConversationActivity.update(true);assertEquals(flag,preview.get().getWindow().getAttributes().flags & flag);
            ConversationActivity.update(false);assertEquals(0,preview.get().getWindow().getAttributes().flags & flag);
            preview.pause().stop();ConversationActivity.update(true);assertEquals(0,preview.get().getWindow().getAttributes().flags & flag);
            preview.start().resume();assertEquals(flag,preview.get().getWindow().getAttributes().flags & flag);
            ConversationActivity.update(false);assertEquals(0,preview.get().getWindow().getAttributes().flags & flag);
        } finally {preview.pause().stop().destroy();ConversationActivity.update(false);}
    }
    @Test public void htmlImagesAndTextPreviewWhileOtherFormatsUseReadOnlySnapshots() throws Exception {
        for (String name : new String[]{"index.html","README.md","picture.png"}) {
            file(name, "file contents"); delivery.open(workspace, name, "{}"); idle();
            Intent intent = Shadows.shadowOf(host).getNextStartedActivity();
            assertEquals(FilePreviewActivity.class.getName(), intent.getComponent().getClassName()); assertEquals(name, intent.getStringExtra("path"));
        }
        File pdf = file("report.pdf", "original PDF"); delivery.open(workspace, "report.pdf", "{}"); idle();
        Intent intent = Shadows.shadowOf(host).getNextStartedActivity();
        assertEquals(Intent.ACTION_VIEW, intent.getAction()); assertEquals("application/pdf", intent.getType());
        assertEquals("content", intent.getData().getScheme()); assertEquals(host.getPackageName()+".files",intent.getData().getAuthority());
        assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, intent.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        Files.write(pdf.toPath(), "changed later".getBytes(StandardCharsets.UTF_8));
        try(InputStream in=host.getContentResolver().openInputStream(intent.getData())) { assertEquals("original PDF",new String(in.readAllBytes(),StandardCharsets.UTF_8)); }
    }
    @Test public void sharingUsesAndroidChooserWithReadOnlyCopy() throws Exception {
        file("notes.txt","share me"); delivery.share(workspace,"notes.txt"); idle();
        Intent chooser=Shadows.shadowOf(host).getNextStartedActivity(); assertNotNull(events.toString(),chooser);assertEquals(Intent.ACTION_CHOOSER,chooser.getAction());
        Intent send=chooser.getParcelableExtra(Intent.EXTRA_INTENT); assertEquals(Intent.ACTION_SEND,send.getAction());
        Uri uri=send.getParcelableExtra(Intent.EXTRA_STREAM); assertEquals("content",uri.getScheme());
        assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION,send.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        try(InputStream in=host.getContentResolver().openInputStream(uri)) { assertEquals("share me",new String(in.readAllBytes(),StandardCharsets.UTF_8)); }
    }
    @Test public void savesGoToPublicDownloadsAndNeverOverwriteOriginalFiles() throws Exception {
        String name="delivery-"+UUID.randomUUID()+".txt"; File original=file(name,"delivered");
        delivery.save(workspace,name); idle(); delivery.save(workspace,name); idle();
        assertEquals("delivered",read(original));
        assertEquals(2,events.stream().filter(e->e.optString("status").equals("saved")).count());
        if(downloads!=null) {
            assertEquals(2,downloads.records.size());
            for(Record record:downloads.records.values()) {
                assertEquals(Environment.DIRECTORY_DOWNLOADS+"/kaipi",record.values.getAsString(MediaStore.Downloads.RELATIVE_PATH));
                assertEquals(Integer.valueOf(0),record.values.getAsInteger(MediaStore.Downloads.IS_PENDING));
                assertEquals("delivered",read(record.file));
            }
        } else {
            File dir=new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),"kaipi");
            assertEquals("delivered",read(new File(dir,name)));
            assertEquals("delivered",read(new File(dir,name.replace(".txt"," (1).txt"))));
        }
    }
    @Test public void failedScopedStorageSaveDeletesTheUnpublishedDownload() throws Exception {
        Assume.assumeTrue(downloads!=null); downloads.fail=true; file("broken.txt","data");
        delivery.save(workspace,"broken.txt"); idle();
        assertTrue(downloads.records.isEmpty()); assertEquals("error",events.get(events.size()-1).getString("status"));
    }
    @Test public void directorySaveProducesAnAccessibleZipWithRelativeResources() throws Exception {
        String name="project-"+UUID.randomUUID();file(name+"/index.html","<link href='assets/style.css'>");file(name+"/assets/style.css","body{}");file(name+"/.kaipi/log","private");
        delivery.save(workspace,name);idle();assertEquals("saved",events.get(events.size()-1).optString("status"));
        File downloaded=downloads!=null?downloads.records.values().iterator().next().file:new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),"kaipi/"+name+".zip");
        try(ZipFile zip=new ZipFile(downloaded)){assertNotNull(zip.getEntry("index.html"));assertNotNull(zip.getEntry("assets/style.css"));assertNull(zip.getEntry(".kaipi/log"));}
    }
    @Test public void legacyStoragePermissionResumesTheSelectedSave() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT<=28);
        String name="permission-"+UUID.randomUUID()+".txt";file(name,"keep me");
        Shadows.shadowOf(host.getApplication()).denyPermissions(android.Manifest.permission.WRITE_EXTERNAL_STORAGE);
        delivery.save(workspace,name);idle();assertTrue(events.isEmpty());
        Shadows.shadowOf(host.getApplication()).grantPermissions(android.Manifest.permission.WRITE_EXTERNAL_STORAGE);
        delivery.permissionResult(true);idle();assertEquals("saved",events.get(events.size()-1).optString("status"));
    }
    private static class Record {
        final ContentValues values; final File file;
        Record(ContentValues values,File file) {this.values=new ContentValues(values);this.file=file;}
    }
    public static class Downloads extends ContentProvider {
        final Map<Uri,Record> records=new LinkedHashMap<>(); int counter; boolean fail;
        @Override public boolean onCreate(){return true;}
        @Override public Uri insert(Uri uri,ContentValues values){
            Uri item=Uri.withAppendedPath(uri,String.valueOf(++counter)); Record record=new Record(values,new File(getContext().getCacheDir(),"download-"+counter));records.put(item,record);
            Shadows.shadowOf(getContext().getContentResolver()).registerOutputStreamSupplier(item,()->{
                if(fail) return new OutputStream(){@Override public void write(int value)throws IOException{throw new IOException("full disk");}};
                try{return new FileOutputStream(record.file);}catch(IOException error){throw new UncheckedIOException(error);}
            });
            return item;
        }
        @Override public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {
            if(fail) throw new FileNotFoundException("full disk");
            return ParcelFileDescriptor.open(records.get(uri).file,ParcelFileDescriptor.MODE_CREATE|ParcelFileDescriptor.MODE_WRITE_ONLY|ParcelFileDescriptor.MODE_TRUNCATE);
        }
        @Override public int update(Uri uri,ContentValues values,String selection,String[] args){records.get(uri).values.putAll(values);return 1;}
        @Override public int delete(Uri uri,String selection,String[] args){Record record=records.remove(uri);if(record!=null)record.file.delete();return 1;}
        @Override public String getType(Uri uri){return "application/octet-stream";}
        @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){return null;}
    }
}
